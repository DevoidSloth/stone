import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { javaSnippets, type JavaSnippets } from '@shared/code-langs'
import { killTree, quote } from './run-code'

/**
 * The object diagram a Java block actually has.
 *
 * A picture of which object holds a reference to which is the one figure a
 * programmer draws by hand more than any other, and the one most often drawn
 * wrong: the whole reason for drawing it is usually that the reader's mental
 * model of the aliasing is not what the program does. So this does not read the
 * source and infer a shape. It compiles the block, runs it, and walks the
 * objects that are really there — two variables that turned out to be one
 * object come out as one box with two arrows into it, because that is what
 * happened.
 *
 * jshell does the work, through its API rather than its prompt. It is the only
 * Java that keeps a name and a value together after the statement that made
 * them has finished, so once the block has run there is a live variable per
 * local with its object still attached, and a helper class evaluated in the
 * same session can reach them all. What that helper writes is `boxes` source —
 * the same fence a person would have typed — so the result is a figure the user
 * owns, editable, diffable, and no different from one they drew themselves.
 *
 * Running it is running the block, so it goes through the same consent the Run
 * button does. The renderer asks once and remembers.
 */

/** The jshell driver, run by the source launcher: no javac step, nothing left behind. */
const DRIVER = `import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Collectors;
import jdk.jshell.Diag;
import jdk.jshell.EvalException;
import jdk.jshell.JShell;
import jdk.jshell.Snippet;
import jdk.jshell.SnippetEvent;
import jdk.jshell.SourceCodeAnalysis;
import jdk.jshell.VarSnippet;

/**
 * Runs one block of Java and writes down what it left in memory.
 *
 * The whole point is that the figure is drawn from the objects themselves
 * rather than from reading the source: the block is compiled and run, and what
 * comes out is whatever is actually on the heap when it stops — the aliasing,
 * the shared tail, the array that turned out to hold the same object twice.
 *
 * jshell is what makes that possible. It compiles a snippet, keeps the value it
 * produced, and keeps the name it was given, so after the block has run there
 * is a live variable per local with its object still attached. The helper class
 * is evaluated in the same session, which is what lets it reach those objects
 * at all — it is not looking at them across a debugging port, it is holding
 * them.
 *
 * Everything it has to say goes in a file, named by a system property. A
 * program being drawn is usually a program that prints, and picking the figure
 * back out of a stdout it shares with the user's own output would be a parser
 * where a file name will do.
 */
public class StoneObjects {

  /** A failure worth showing the user, as opposed to a stack trace. */
  static class Failure extends RuntimeException {
    Failure(String message) {
      super(message);
    }
  }

  /**
   * What a block above this one got wrong, if one did, and only the first.
   *
   * The blocks above are run for what they declare, and a note is not a program
   * — one of them may be a fragment that was never going to compile, and the
   * block being drawn may not care. So they are run tolerantly. But when the
   * block being drawn then fails, an earlier failure is very often the reason
   * for it, and this is how it gets said.
   */
  static String earlier = null;

  public static void main(String[] args) {
    Path dir = Path.of(args[0]);
    JShell shell = null;
    try {
      String helper = Files.readString(dir.resolve("dump.java"));
      String source = Files.readString(dir.resolve("code.java"));
      String aliases = Files.readString(dir.resolve("aliases.java"));
      String statements = Files.readString(dir.resolve("statements.java"));
      System.setProperty("stone.diagram.out", dir.resolve("boxes.txt").toString());

      shell = JShell.builder()
          // The same VM, which is what lets the helper touch the user's
          // objects, and one JVM start-up instead of two.
          .executionEngine("local")
          // A block that reads stdin gets an end of file rather than hanging on
          // a pipe nobody is typing into.
          .in(new ByteArrayInputStream(new byte[0]))
          .build();

      run(shell, helper, "Stone's own helper");
      above(shell, dir);
      run(shell, source, "the block");
      offer(shell, aliases);
      run(shell, statements, "the body of main");

      StringBuilder dump = new StringBuilder();
      for (VarSnippet variable : shell.variables().collect(Collectors.toList())) {
        String name = variable.name();
        // jshell names the value of a loose expression \`$1\`, which is a real
        // variable and not one the user would recognise as theirs.
        if (name.isEmpty() || name.charAt(0) == '$' || name.startsWith("__Stone")) continue;
        dump.append("__StoneDump.root(\\"").append(name).append("\\", ").append(name).append(");\\n");
      }
      dump.append("__StoneDump.emit(System.getProperty(\\"stone.diagram.out\\"));\\n");
      run(shell, dump.toString(), "the drawing");
    } catch (Failure failure) {
      System.err.println(failure.getMessage() + (earlier == null ? "" : " " + earlier));
      System.exit(1);
    } catch (Throwable other) {
      System.err.println(other.toString());
      System.exit(1);
    } finally {
      if (shell != null) shell.close();
    }
  }

  /**
   * Declarations that are only worth having if they stand on their own.
   *
   * The nested types and static helpers beside \`main\`, offered again at the top
   * level so the body of \`main\` can see them by the names it calls them. One
   * that will not compile out there — a helper leaning on a field that stayed
   * behind in the class — is dropped without a word: it was a courtesy, and the
   * statement that needed it will say so itself in a moment.
   */
  static void offer(JShell shell, String source) {
    String rest = source;
    while (rest != null && !rest.isBlank()) {
      SourceCodeAnalysis.CompletionInfo split = shell.sourceCodeAnalysis().analyzeCompletion(rest);
      String unit = split.source();
      if (unit == null || unit.isBlank()) return;
      shell.eval(unit);
      rest = split.remaining();
    }
  }

  /**
   * Run the blocks above this one, for what they leave behind.
   *
   * Each is handled exactly as the block being drawn is — declarations, then
   * the helpers beside main offered at the top level, then the body of main —
   * because that is the handling that made it work when the user ran it.
   */
  static void above(JShell shell, Path dir) throws Exception {
    Path count = dir.resolve("prelude.count");
    if (!Files.exists(count)) return;
    int blocks = Integer.parseInt(Files.readString(count).trim());
    for (int n = 0; n < blocks; n++) {
      tolerate(shell, Files.readString(dir.resolve("prelude-" + n + "-source.java")), n + 1);
      offer(shell, Files.readString(dir.resolve("prelude-" + n + "-aliases.java")));
      tolerate(shell, Files.readString(dir.resolve("prelude-" + n + "-statements.java")), n + 1);
    }
  }

  /**
   * As run, but for a block above: it is allowed to fail, and only remembered.
   *
   * A note is not a program. The blocks above the one being drawn are whatever
   * the user wrote up there — a finished class, or three lines of an interface
   * to make a point — and a fragment among them is no reason to refuse to draw
   * a block that never needed it.
   */
  static void tolerate(JShell shell, String source, int which) {
    String rest = source;
    while (rest != null && !rest.isBlank()) {
      SourceCodeAnalysis.CompletionInfo split = shell.sourceCodeAnalysis().analyzeCompletion(rest);
      String unit = split.source();
      if (unit == null || unit.isBlank()) return;
      for (SnippetEvent event : shell.eval(unit)) {
        if (event.causeSnippet() != null || earlier != null) continue;

        if (event.status() == Snippet.Status.REJECTED) {
          String said = shell.diagnostics(event.snippet())
              .map(diagnostic -> diagnostic.getMessage(null))
              .collect(Collectors.joining(" "));
          earlier = "Java block " + which + " above it was not accepted either: " + first(unit)
              + (said.isEmpty() ? "" : " — " + said);
        } else if (event.exception() != null) {
          Throwable thrown = event.exception();
          earlier = "Java block " + which + " above it threw "
              + (thrown instanceof EvalException
                  ? ((EvalException) thrown).getExceptionClassName()
                  : thrown.getClass().getName())
              + ".";
        }
      }
      rest = split.remaining();
    }
  }

  /** Split a piece of source into snippets the way jshell itself would, and run each. */
  static void run(JShell shell, String source, String what) {
    String rest = source;
    while (rest != null && !rest.isBlank()) {
      SourceCodeAnalysis.CompletionInfo split = shell.sourceCodeAnalysis().analyzeCompletion(rest);
      String unit = split.source();
      if (unit == null || unit.isBlank()) {
        throw new Failure("Stone could not read the end of " + what + ": " + first(rest));
      }
      eval(shell, unit, what);
      rest = split.remaining();
    }
  }

  static void eval(JShell shell, String unit, String what) {
    for (SnippetEvent event : shell.eval(unit)) {
      // A snippet re-run because something it depended on was replaced. Its
      // outcome belongs to the snippet that caused it, which is reported anyway.
      if (event.causeSnippet() != null) continue;

      if (event.exception() != null) {
        Throwable thrown = event.exception();
        String threw = thrown instanceof EvalException
            ? ((EvalException) thrown).getExceptionClassName()
            : thrown.getClass().getName();
        String message = thrown.getMessage();
        throw new Failure(
            "Running " + what + " threw " + threw + (message == null ? "" : ": " + message));
      }

      if (event.status() == Snippet.Status.REJECTED) {
        String said = shell.diagnostics(event.snippet())
            .map(diagnostic -> diagnostic.getMessage(null))
            .collect(Collectors.joining(" "));
        throw new Failure(
            "Java would not accept " + first(unit) + (said.isEmpty() ? "" : " — " + said) + hint(what));
      }
    }
  }

  /**
   * The one failure that is Stone's doing rather than the user's.
   *
   * A program's locals are drawn by running the body of \`main\` at the top level
   * instead of calling \`main\`, because a call takes its locals away with it
   * when it returns. The cost is the class's own scope: \`helper()\` next to
   * \`main\` is \`Main.helper()\` from outside it, and saying so is the difference
   * between a diagram that can be got working and one that just failed.
   */
  static String hint(String what) {
    if (!what.equals("the body of main")) return "";
    return ". Stone runs the statements in main at the top level so their locals survive to be"
        + " drawn, and a method of the class has to be called by name there, as Main.helper().";
  }

  static String first(String source) {
    for (String line : source.split("\\n")) {
      if (!line.isBlank()) return "\`" + line.trim() + "\`";
    }
    return "that";
  }
}
`

/** Evaluated inside the session, where it can hold the objects rather than describe them. */
const DUMPER = `class __StoneDump {
  static final java.util.List<String> vars = new java.util.ArrayList<>();
  static final java.util.List<String> boxes = new java.util.ArrayList<>();
  static final java.util.Map<Object, String> ids = new java.util.IdentityHashMap<>();
  static final java.util.List<Object> queue = new java.util.ArrayList<>();
  static boolean truncated = false;

  static final int MAX_OBJECTS = 40;
  static final int MAX_CELLS = 24;
  static final int MAX_FIELDS = 20;
  static final int MAX_TEXT = 44;

  /** The name this object is wired up by, or null once the drawing is full. */
  static String id(Object value) {
    String had = ids.get(value);
    if (had != null) return had;
    if (ids.size() >= MAX_OBJECTS) {
      truncated = true;
      return null;
    }
    String name = "o" + (ids.size() + 1);
    ids.put(value, name);
    queue.add(value);
    return name;
  }

  /** Something that goes in a slot as itself, rather than as an arrow. */
  static boolean scalar(Object value) {
    return value instanceof String || value instanceof Number || value instanceof Boolean
        || value instanceof Character || value instanceof Enum || value instanceof Class;
  }

  static String clean(String raw) {
    String out = raw.replace('\\n', ' ').replace('\\r', ' ').replace('\\t', ' ').replace('|', ' ').trim();
    if (out.length() > MAX_TEXT) out = out.substring(0, MAX_TEXT - 1) + "…";
    return out;
  }

  /** A field name or a map key, with the characters the figure reads as syntax taken out. */
  static String name(String raw) {
    String out = clean(raw).replace(':', ' ').replace('=', ' ').replace('>', ' ').replace('-', ' ').trim();
    return out.isEmpty() ? "?" : out;
  }

  /** What goes on the right of a field, or inside a slot: a value, an arrow, or null. */
  static String value(Object held) {
    if (held == null) return "null";
    if (held instanceof String) return "\\"" + clean((String) held) + "\\"";
    if (held instanceof Character) return "'" + clean(String.valueOf(held)) + "'";
    if (scalar(held)) return clean(String.valueOf(held));
    String id = id(held);
    return id == null ? "…" : "->" + id;
  }

  /** A variable of the block: the little box the whole picture hangs from. */
  static void root(String label, Object held) {
    if (held == null) {
      vars.add(label + " -> null");
      return;
    }
    if (scalar(held)) {
      vars.add(label + " = " + value(held));
      return;
    }
    String id = id(held);
    vars.add(id == null ? label + " = …" : label + " -> " + id);
  }

  static void field(String label, Object held) {
    String rendered = value(held);
    boxes.add(rendered.startsWith("->")
        ? "  " + label + " -> " + rendered.substring(2)
        : "  " + label + ": " + rendered);
  }

  /**
   * What to write on the face of a box.
   *
   * The class's own name, except when the platform has handed back one of its
   * private implementations — \`List.of(a, b)\` is an \`ImmutableCollections$List12\`
   * and nobody wants that drawn on a diagram. Those are named by what they are
   * to the program that holds them, which is the interface they arrived as.
   */
  static String typeName(Class<?> type) {
    if (!java.lang.reflect.Modifier.isPublic(type.getModifiers())) {
      // In the order a person would name the thing: what it is, not what it
      // happens to implement. \`Serializable\` is true of half the platform and
      // says nothing about the object on the page.
      Class<?>[] shapes = {
        java.util.Map.class, java.util.List.class, java.util.Set.class,
        java.util.Queue.class, java.util.Collection.class
      };
      for (Class<?> shape : shapes) {
        if (shape.isAssignableFrom(type)) return shape.getSimpleName();
      }
      Class<?> parent = type.getSuperclass();
      if (parent != null && parent != Object.class) return typeName(parent);
    }
    String name = type.getSimpleName();
    if (name == null || name.isEmpty()) name = type.getName();
    int cut = Math.max(name.lastIndexOf('$'), name.lastIndexOf('.'));
    if (cut >= 0) name = name.substring(cut + 1);
    if (name.isEmpty() || Character.isDigit(name.charAt(0))) return "(anonymous)";
    return name;
  }

  /**
   * Whether this came with the platform.
   *
   * A \`LocalDate\` has seven private fields and none of them is what anyone
   * means by the date, and under the module system half of them refuse to be
   * read at all. So a platform object is drawn as what it prints as.
   */
  static boolean platform(Class<?> type) {
    String name = type.getName();
    return name.startsWith("java.") || name.startsWith("javax.") || name.startsWith("jdk.")
        || name.startsWith("sun.") || name.startsWith("com.sun.");
  }

  static void array(String id, Object held, Class<?> type) {
    int length = java.lang.reflect.Array.getLength(held);
    int shown = Math.min(length, MAX_CELLS);
    StringBuilder line = new StringBuilder(id + " " + typeName(type) + " [ ");
    for (int i = 0; i < shown; i++) {
      if (i > 0) line.append(", ");
      line.append(value(java.lang.reflect.Array.get(held, i)));
    }
    if (shown < length) line.append(shown > 0 ? ", …" : "…");
    boxes.add(line.append(" ]").toString());
  }

  static void list(String id, Iterable<?> held, Class<?> type) {
    StringBuilder line = new StringBuilder(id + " " + typeName(type) + " [ ");
    int shown = 0;
    for (Object item : held) {
      if (shown >= MAX_CELLS) {
        line.append(", …");
        break;
      }
      if (shown > 0) line.append(", ");
      line.append(value(item));
      shown++;
    }
    boxes.add(line.append(" ]").toString());
  }

  static void map(String id, java.util.Map<?, ?> held, Class<?> type) {
    boxes.add(id + " " + typeName(type) + ":");
    int shown = 0;
    for (java.util.Map.Entry<?, ?> entry : held.entrySet()) {
      if (shown++ >= MAX_FIELDS) {
        boxes.add("  …");
        return;
      }
      field(name(String.valueOf(entry.getKey())), entry.getValue());
    }
  }

  static void opaque(String id, Object held, Class<?> type) {
    boxes.add(id + " " + typeName(type) + ":");
    String shown;
    try {
      shown = clean(String.valueOf(held));
    } catch (Throwable failed) {
      shown = "…";
    }
    boxes.add("  value: " + (shown.isEmpty() ? "\\"\\"" : shown));
  }

  static void object(String id, Object held, Class<?> type) {
    boxes.add(id + " " + typeName(type) + ":");
    int shown = 0;
    for (Class<?> at = type; at != null && at != Object.class; at = at.getSuperclass()) {
      for (java.lang.reflect.Field member : at.getDeclaredFields()) {
        if (java.lang.reflect.Modifier.isStatic(member.getModifiers()) || member.isSynthetic()) continue;
        if (shown++ >= MAX_FIELDS) {
          boxes.add("  …");
          return;
        }
        try {
          member.setAccessible(true);
          field(name(member.getName()), member.get(held));
        } catch (Throwable denied) {
          // A field that will not be read is still a field: draw the slot empty
          // rather than pretending the object does not have it.
          boxes.add("  " + name(member.getName()));
        }
      }
    }
  }

  /** Everything reachable, breadth first, so a chain comes out in its own order. */
  static void walk() {
    for (int i = 0; i < queue.size(); i++) {
      Object item = queue.get(i);
      String id = ids.get(item);
      Class<?> type = item.getClass();
      try {
        if (type.isArray()) array(id, item, type);
        else if (item instanceof java.util.Map) map(id, (java.util.Map<?, ?>) item, type);
        else if (item instanceof Iterable) list(id, (Iterable<?>) item, type);
        else if (platform(type)) opaque(id, item, type);
        else object(id, item, type);
      } catch (Throwable failed) {
        boxes.add(id + " " + typeName(type) + " ~");
      }
    }
  }

  static void emit(String path) throws Exception {
    walk();
    StringBuilder out = new StringBuilder();
    for (String line : vars) out.append(line).append('\\n');
    if (!vars.isEmpty() && !boxes.isEmpty()) out.append('\\n');
    for (String line : boxes) out.append(line).append('\\n');
    if (truncated) {
      out.append("\\ncaption: Stopped at ").append(MAX_OBJECTS).append(" objects.\\n");
    }
    java.nio.file.Files.writeString(java.nio.file.Path.of(path), out.toString());
  }
}
`

export interface ObjectDiagramRequest {
  /** The fenced block, as written. */
  code: string
  /**
   * The note's earlier Java blocks, in the order they appear in it.
   *
   * A run joins the note's session and so already has whatever the blocks above
   * it declared. A drawing cannot: the dumper has to be evaluated beside the
   * user's objects, which means a JShell built through the API rather than the
   * `jshell` process a session drives over a pipe. So the blocks above are
   * re-run in front of this one, and a note that declares its types in one
   * block and uses them in the next is drawable.
   *
   * They are re-run, not resumed, and the difference shows in two places: a
   * block above with a side effect has it again, and a variable one of them
   * declared is a variable this JShell holds, so it is drawn too. Both are what
   * the session would have shown.
   */
  prelude: string[]
  /** Where java runs — the note's folder, so a block that reads a file still can. */
  cwd: string | null
  timeoutMs: number
}

/** Enough of a failure to explain it; a stack trace past this helps nobody. */
const MAX_ERROR = 600

/**
 * One line, at a readable length.
 *
 * javac's diagnostics arrive over three lines with the symbol and the location
 * indented under them, and the status bar of a code block is one line high.
 */
function oneLine(text: string): string {
  const said = text.replace(/\s+/g, ' ').trim()
  return said.length > MAX_ERROR ? `${said.slice(0, MAX_ERROR - 1)}…` : said
}

/** What a failure from the shell most likely means, in the user's terms. */
function explain(stderr: string, code: number | null): string {
  const said = oneLine(stderr)
  if (/command not found|not recognized|No such file or directory/i.test(said) && /java/i.test(said)) {
    return 'Stone could not find `java`. Drawing a Java block needs a JDK — 11 or newer — on the same path your terminal uses.'
  }
  if (/package jdk\.jshell|cannot find symbol.*JShell|invalid flag|Unrecognized option/i.test(said)) {
    return 'The `java` on this machine cannot run this: drawing a block needs a JDK 11 or newer, not a JRE.'
  }
  return said || `java stopped with code ${code ?? 'unknown'} and said nothing.`
}

/**
 * Run the driver through the user's login shell.
 *
 * The same reasoning as running a block: an app launched from the Finder has a
 * PATH with no sdkman, no jenv and no homebrew in it, so `java` here has to mean
 * the `java` their terminal means.
 */
function shellRun(
  line: string,
  cwd: string | null,
  timeoutMs: number
): Promise<{ code: number | null; stderr: string }> {
  const shell =
    process.platform === 'win32' ? (process.env.COMSPEC ?? 'cmd.exe') : (process.env.SHELL ?? '/bin/sh')
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', line] : ['-lc', line]

  return new Promise((resolve, reject) => {
    const child = spawn(shell, args, {
      cwd: cwd ?? os.homedir(),
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: process.platform !== 'win32',
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', TERM: 'dumb' }
    })

    let stderr = ''
    let timedOut = false
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 8000) stderr += chunk.toString()
    })

    const timer = setTimeout(() => {
      timedOut = true
      killTree(child, 'SIGKILL')
    }, timeoutMs)

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`${shell} could not be started: ${err.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) {
        reject(
          new Error(
            `The block was still running after ${Math.round(timeoutMs / 1000)} seconds and was stopped, so there was nothing to draw.`
          )
        )
        return
      }
      resolve({ code, stderr })
    })
  })
}

/**
 * Draw a Java block, and hand back the `boxes` source for what it left behind.
 *
 * Throws with something worth reading: a block that will not compile is the
 * common case, and javac's own words about it are better than anything Stone
 * could say instead.
 */
export async function objectDiagram(request: ObjectDiagramRequest): Promise<string> {
  const parts = javaSnippets(request.code)
  if ('reason' in parts) throw new Error(parts.reason)

  // A block above that will not even parse is dropped rather than reported: it
  // was never runnable, so it is not what this drawing is about, and the block
  // being drawn will say for itself if it needed something from it.
  const above = request.prelude
    .map((block) => javaSnippets(block))
    .filter((split): split is JavaSnippets => !('reason' in split))

  const dir = await mkdtemp(path.join(os.tmpdir(), 'stone-objects-'))
  try {
    await Promise.all([
      writeFile(path.join(dir, 'StoneObjects.java'), DRIVER, 'utf8'),
      writeFile(path.join(dir, 'dump.java'), DUMPER, 'utf8'),
      writeFile(path.join(dir, 'code.java'), parts.source, 'utf8'),
      writeFile(path.join(dir, 'aliases.java'), parts.aliases.join('\n\n'), 'utf8'),
      writeFile(path.join(dir, 'statements.java'), parts.statements, 'utf8'),
      writeFile(path.join(dir, 'prelude.count'), String(above.length), 'utf8'),
      ...above.flatMap((block, n) => [
        writeFile(path.join(dir, `prelude-${n}-source.java`), block.source, 'utf8'),
        writeFile(path.join(dir, `prelude-${n}-aliases.java`), block.aliases.join('\n\n'), 'utf8'),
        writeFile(path.join(dir, `prelude-${n}-statements.java`), block.statements, 'utf8')
      ])
    ])

    const line = `java ${quote(path.join(dir, 'StoneObjects.java'))} ${quote(dir)}`
    const { code, stderr } = await shellRun(line, request.cwd, request.timeoutMs)
    if (code !== 0) throw new Error(explain(stderr, code))

    const drawn = await readFile(path.join(dir, 'boxes.txt'), 'utf8').catch(() => '')
    if (!drawn.trim()) {
      throw new Error(
        'The block ran and left nothing to draw. The figure is built from the variables the block declares, so give it something to hold.'
      )
    }
    return drawn.trim()
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
