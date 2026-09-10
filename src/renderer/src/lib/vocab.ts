/**
 * What a language already knows: its keywords, and the names its standard
 * library puts in front of you without an import.
 *
 * The companion to `symbols`, which reads what *this note* declares. Between
 * them they answer the two questions a suggestion list in a code block is for —
 * "what can I write here" and "what did I call that thing above" — and neither
 * needs a language server, a toolchain on the machine, or a network round trip.
 *
 * The lists are deliberately shallow. A real index of Python's standard library
 * is tens of thousands of names, and pasting it into a notes app would bury the
 * six names the person actually declared four lines up under a wall of
 * `zoneinfo`. What is here is the surface someone writing a twenty-line block
 * in a note reaches for: the keywords, the builtins, the handful of types and
 * functions that appear in almost every snippet. Anything deeper is better
 * served by the block being run than by being guessed at.
 *
 * `member` names are the ones worth offering after a dot. They are not typed —
 * nothing here knows what the receiver is — so they are ranked below everything
 * else and exist to save typing `append` rather than to claim it is correct.
 */

export interface Vocabulary {
  keywords: string[]
  /** Functions, types and constants available with nothing imported. */
  builtins: string[]
  /** Methods common enough to be worth offering after a `.`. */
  members: string[]
}

const EMPTY: string[] = []

/**
 * The tables, keyed by the ids in `code-langs`. A language that shares another's
 * shape shares its entry — `zsh` is `bash`, `typescript` is JavaScript with a
 * type system bolted on — and the aliases are resolved in `vocabFor`.
 */
const VOCAB: Record<string, Vocabulary> = {
  javascript: {
    keywords: [
      'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
      'default', 'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'from',
      'function', 'get', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'of', 'return',
      'set', 'static', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void',
      'while', 'yield', 'true', 'false', 'null', 'undefined'
    ],
    builtins: [
      'Array', 'ArrayBuffer', 'BigInt', 'Boolean', 'Date', 'Error', 'Function', 'Infinity',
      'Intl', 'JSON', 'Map', 'Math', 'NaN', 'Number', 'Object', 'Promise', 'Proxy', 'RegExp',
      'Set', 'String', 'Symbol', 'TypeError', 'Uint8Array', 'WeakMap', 'WeakSet',
      'console.log', 'console.error', 'console.table', 'console.warn',
      'decodeURIComponent', 'encodeURIComponent', 'fetch', 'globalThis', 'isNaN',
      'parseFloat', 'parseInt', 'process', 'queueMicrotask', 'require', 'setInterval',
      'setTimeout', 'structuredClone'
    ],
    members: [
      'at', 'bind', 'call', 'catch', 'charAt', 'concat', 'endsWith', 'entries', 'every',
      'filter', 'finally', 'find', 'findIndex', 'flat', 'flatMap', 'forEach', 'includes',
      'indexOf', 'join', 'keys', 'length', 'map', 'match', 'padStart', 'pop', 'push',
      'reduce', 'repeat', 'replace', 'replaceAll', 'reverse', 'shift', 'slice', 'some',
      'sort', 'split', 'startsWith', 'then', 'toFixed', 'toLowerCase', 'toString',
      'toUpperCase', 'trim', 'unshift', 'values'
    ]
  },

  typescript: {
    keywords: [
      'abstract', 'as', 'asserts', 'declare', 'enum', 'implements', 'infer', 'interface',
      'is', 'keyof', 'namespace', 'never', 'private', 'protected', 'public', 'readonly',
      'satisfies', 'type', 'unknown'
    ],
    builtins: [
      'Awaited', 'Exclude', 'Extract', 'NonNullable', 'Omit', 'Parameters', 'Partial',
      'Pick', 'Readonly', 'Record', 'Required', 'ReturnType', 'any', 'bigint', 'boolean',
      'number', 'object', 'string', 'symbol', 'unknown', 'void'
    ],
    members: EMPTY
  },

  python: {
    keywords: [
      'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
      'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in',
      'is', 'lambda', 'match', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try',
      'while', 'with', 'yield', 'True', 'False', 'None'
    ],
    builtins: [
      'abs', 'all', 'any', 'bin', 'bool', 'bytes', 'callable', 'chr', 'classmethod',
      'dataclass', 'dict', 'dir', 'divmod', 'enumerate', 'eval', 'filter', 'float',
      'format', 'frozenset', 'getattr', 'hasattr', 'hash', 'hex', 'id', 'input', 'int',
      'isinstance', 'issubclass', 'iter', 'len', 'list', 'map', 'max', 'min', 'next',
      'object', 'open', 'ord', 'pow', 'print', 'property', 'range', 'repr', 'reversed',
      'round', 'set', 'setattr', 'slice', 'sorted', 'staticmethod', 'str', 'sum', 'super',
      'tuple', 'type', 'vars', 'zip',
      '__init__', '__main__', '__name__', '__repr__', '__str__',
      'collections', 'datetime', 'functools', 'itertools', 'json', 'math', 'os', 'pathlib',
      're', 'random', 'sys', 'typing'
    ],
    members: [
      'append', 'clear', 'copy', 'count', 'endswith', 'extend', 'format', 'get', 'index',
      'insert', 'items', 'join', 'keys', 'lower', 'lstrip', 'pop', 'read', 'remove',
      'replace', 'reverse', 'rstrip', 'setdefault', 'sort', 'split', 'splitlines',
      'startswith', 'strip', 'title', 'update', 'upper', 'values', 'write'
    ]
  },

  java: {
    keywords: [
      'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class',
      'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally',
      'float', 'for', 'if', 'implements', 'import', 'instanceof', 'int', 'interface',
      'long', 'native', 'new', 'package', 'private', 'protected', 'public', 'record',
      'return', 'sealed', 'short', 'static', 'super', 'switch', 'synchronized', 'this',
      'throw', 'throws', 'transient', 'try', 'var', 'void', 'volatile', 'while', 'yield',
      'true', 'false', 'null'
    ],
    builtins: [
      'ArrayList', 'Arrays', 'Boolean', 'Character', 'Collections', 'Comparable',
      'Comparator', 'Double', 'Exception', 'HashMap', 'HashSet', 'Integer', 'Iterable',
      'Iterator', 'LinkedList', 'List', 'Long', 'Map', 'Math', 'Object', 'Optional',
      'Queue', 'Runnable', 'Set', 'Stream', 'String', 'StringBuilder', 'System.out.println',
      'System.err.println', 'Thread', 'TreeMap', 'public static void main'
    ],
    members: [
      'add', 'apply', 'charAt', 'clear', 'collect', 'compareTo', 'contains', 'containsKey',
      'equals', 'filter', 'forEach', 'get', 'getOrDefault', 'hashCode', 'indexOf',
      'isEmpty', 'iterator', 'length', 'map', 'put', 'remove', 'size', 'sort', 'stream',
      'substring', 'toArray', 'toLowerCase', 'toString', 'toUpperCase', 'trim', 'values'
    ]
  },

  go: {
    keywords: [
      'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough',
      'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range',
      'return', 'select', 'struct', 'switch', 'type', 'var', 'true', 'false', 'nil', 'iota'
    ],
    builtins: [
      'append', 'bool', 'byte', 'cap', 'close', 'complex', 'copy', 'delete', 'error',
      'float64', 'int', 'int64', 'len', 'make', 'new', 'panic', 'print', 'println',
      'recover', 'rune', 'string', 'uint', 'fmt.Errorf', 'fmt.Print', 'fmt.Printf',
      'fmt.Println', 'fmt.Sprintf', 'errors.New', 'os.Exit', 'strings.Split',
      'strings.Join', 'strconv.Atoi', 'strconv.Itoa', 'sort.Slice', 'sync.WaitGroup'
    ],
    members: EMPTY
  },

  rust: {
    keywords: [
      'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else', 'enum',
      'extern', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move',
      'mut', 'pub', 'ref', 'return', 'self', 'static', 'struct', 'super', 'trait', 'type',
      'unsafe', 'use', 'where', 'while', 'true', 'false'
    ],
    builtins: [
      'Box', 'Clone', 'Copy', 'Debug', 'Default', 'Err', 'HashMap', 'HashSet', 'Iterator',
      'None', 'Ok', 'Option', 'Rc', 'RefCell', 'Result', 'Some', 'String', 'Vec', 'bool',
      'char', 'f64', 'i32', 'i64', 'str', 'u8', 'usize', 'assert!', 'assert_eq!',
      'format!', 'panic!', 'print!', 'println!', 'vec!', 'write!', 'todo!'
    ],
    members: [
      'as_str', 'borrow', 'clone', 'collect', 'contains', 'enumerate', 'expect', 'filter',
      'filter_map', 'fold', 'get', 'insert', 'into', 'is_empty', 'iter', 'iter_mut', 'len',
      'map', 'next', 'parse', 'push', 'push_str', 'to_owned', 'to_string', 'unwrap',
      'unwrap_or', 'unwrap_or_else'
    ]
  },

  c: {
    keywords: [
      'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double',
      'else', 'enum', 'extern', 'float', 'for', 'goto', 'if', 'inline', 'int', 'long',
      'register', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch',
      'typedef', 'union', 'unsigned', 'void', 'volatile', 'while',
      '#include', '#define', '#ifndef', '#endif', '#pragma once'
    ],
    builtins: [
      'NULL', 'size_t', 'bool', 'calloc', 'exit', 'fclose', 'fgets', 'fopen', 'fprintf',
      'free', 'fscanf', 'malloc', 'memcpy', 'memset', 'printf', 'putchar', 'puts',
      'realloc', 'scanf', 'snprintf', 'sprintf', 'strcmp', 'strcpy', 'strlen', 'strncpy',
      'stdout', 'stderr', 'stdin'
    ],
    members: EMPTY
  },

  cpp: {
    keywords: [
      'auto', 'break', 'case', 'catch', 'class', 'const', 'constexpr', 'continue',
      'decltype', 'default', 'delete', 'do', 'else', 'enum', 'explicit', 'export', 'extern',
      'for', 'friend', 'if', 'inline', 'mutable', 'namespace', 'new', 'noexcept',
      'nullptr', 'operator', 'override', 'private', 'protected', 'public', 'return',
      'sizeof', 'static', 'static_cast', 'struct', 'switch', 'template', 'this', 'throw',
      'try', 'typedef', 'typename', 'union', 'using', 'virtual', 'void', 'while',
      'true', 'false', '#include'
    ],
    builtins: [
      'std::array', 'std::cerr', 'std::cin', 'std::cout', 'std::endl', 'std::function',
      'std::make_shared', 'std::make_unique', 'std::map', 'std::move', 'std::optional',
      'std::pair', 'std::set', 'std::shared_ptr', 'std::sort', 'std::string',
      'std::unique_ptr', 'std::unordered_map', 'std::vector', 'size_t',
      'using namespace std;', 'int main()'
    ],
    members: [
      'at', 'back', 'begin', 'clear', 'count', 'emplace_back', 'empty', 'end', 'erase',
      'find', 'front', 'insert', 'push_back', 'reserve', 'resize', 'size', 'substr'
    ]
  },

  ruby: {
    keywords: [
      'alias', 'and', 'begin', 'break', 'case', 'class', 'def', 'defined?', 'do', 'elsif',
      'else', 'end', 'ensure', 'for', 'if', 'in', 'module', 'next', 'nil', 'not', 'or',
      'raise', 'redo', 'require', 'require_relative', 'rescue', 'retry', 'return', 'self',
      'super', 'then', 'unless', 'until', 'when', 'while', 'yield', 'true', 'false',
      'attr_accessor', 'attr_reader', 'attr_writer'
    ],
    builtins: [
      'Array', 'Comparable', 'Enumerable', 'Float', 'Hash', 'Integer', 'Range', 'String',
      'Struct', 'Symbol', 'freeze', 'gets', 'lambda', 'loop', 'p', 'proc', 'puts', 'pp',
      'print', 'rand', 'sleep'
    ],
    members: [
      'each', 'each_with_index', 'map', 'select', 'reject', 'reduce', 'inject', 'sort_by',
      'group_by', 'include?', 'empty?', 'nil?', 'any?', 'all?', 'first', 'last', 'length',
      'size', 'push', 'pop', 'join', 'split', 'strip', 'to_a', 'to_i', 'to_s', 'to_sym',
      'upcase', 'downcase', 'gsub', 'sub', 'keys', 'values', 'fetch'
    ]
  },

  php: {
    keywords: [
      'abstract', 'array', 'as', 'break', 'callable', 'case', 'catch', 'class', 'clone',
      'const', 'continue', 'declare', 'default', 'do', 'echo', 'else', 'elseif', 'enum',
      'extends', 'final', 'finally', 'fn', 'for', 'foreach', 'function', 'global', 'if',
      'implements', 'include', 'instanceof', 'interface', 'match', 'namespace', 'new',
      'print', 'private', 'protected', 'public', 'readonly', 'require', 'return', 'static',
      'switch', 'throw', 'trait', 'try', 'use', 'var', 'while', 'yield', 'true', 'false',
      'null', '<?php'
    ],
    builtins: [
      'array_filter', 'array_keys', 'array_map', 'array_merge', 'array_reduce',
      'array_values', 'count', 'die', 'explode', 'implode', 'in_array', 'is_array',
      'isset', 'json_decode', 'json_encode', 'preg_match', 'preg_replace', 'printf',
      'sprintf', 'str_replace', 'strlen', 'strpos', 'strtolower', 'strtoupper', 'substr',
      'trim', 'usort', 'var_dump', '$this'
    ],
    members: EMPTY
  },

  perl: {
    keywords: [
      'and', 'do', 'else', 'elsif', 'eq', 'eval', 'for', 'foreach', 'if', 'last', 'local',
      'my', 'ne', 'next', 'not', 'or', 'our', 'package', 'redo', 'require', 'return',
      'sub', 'unless', 'until', 'use', 'wantarray', 'while',
      'use strict;', 'use warnings;'
    ],
    builtins: [
      'chomp', 'chop', 'defined', 'delete', 'die', 'exists', 'grep', 'join', 'keys',
      'length', 'map', 'open', 'pop', 'print', 'printf', 'push', 'reverse', 'scalar',
      'shift', 'sort', 'splice', 'split', 'sprintf', 'substr', 'unshift', 'values', 'warn'
    ],
    members: EMPTY
  },

  lua: {
    keywords: [
      'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto',
      'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until',
      'while'
    ],
    builtins: [
      'assert', 'error', 'ipairs', 'next', 'pairs', 'pcall', 'print', 'rawget', 'require',
      'select', 'setmetatable', 'tonumber', 'tostring', 'type', 'unpack',
      'table.concat', 'table.insert', 'table.remove', 'table.sort',
      'string.format', 'string.gsub', 'string.rep', 'string.sub', 'math.floor',
      'math.max', 'math.min', 'math.random', 'io.write'
    ],
    members: EMPTY
  },

  r: {
    keywords: [
      'break', 'else', 'for', 'function', 'if', 'in', 'next', 'repeat', 'return', 'while',
      'TRUE', 'FALSE', 'NULL', 'NA', 'Inf', 'NaN', 'library', 'require'
    ],
    builtins: [
      'apply', 'as.character', 'as.numeric', 'c', 'cat', 'colnames', 'data.frame', 'dim',
      'factor', 'head', 'ifelse', 'is.na', 'lapply', 'length', 'list', 'matrix', 'max',
      'mean', 'median', 'min', 'names', 'ncol', 'nrow', 'paste', 'paste0', 'plot', 'print',
      'range', 'rep', 'rnorm', 'round', 'sapply', 'sd', 'seq', 'setNames', 'sort', 'sum',
      'summary', 'table', 'tail', 'unique', 'vapply', 'which'
    ],
    members: EMPTY
  },

  bash: {
    keywords: [
      'case', 'do', 'done', 'elif', 'else', 'esac', 'export', 'fi', 'for', 'function',
      'if', 'in', 'local', 'readonly', 'return', 'select', 'shift', 'then', 'until',
      'while', 'set -euo pipefail'
    ],
    builtins: [
      'awk', 'basename', 'cat', 'cd', 'chmod', 'cp', 'curl', 'cut', 'date', 'dirname',
      'echo', 'env', 'eval', 'exec', 'exit', 'find', 'grep', 'head', 'jq', 'kill', 'ln',
      'ls', 'mkdir', 'mktemp', 'mv', 'printf', 'pwd', 'read', 'rm', 'sed', 'sleep', 'sort',
      'source', 'tail', 'tar', 'tee', 'test', 'touch', 'tr', 'trap', 'uniq', 'wc', 'wait',
      'which', 'xargs'
    ],
    members: EMPTY
  },

  powershell: {
    keywords: [
      'begin', 'break', 'catch', 'class', 'continue', 'do', 'else', 'elseif', 'end',
      'enum', 'exit', 'filter', 'finally', 'for', 'foreach', 'function', 'if', 'in',
      'param', 'process', 'return', 'switch', 'throw', 'try', 'until', 'while',
      '$true', '$false', '$null', '$_', '$PSItem'
    ],
    builtins: [
      'Compare-Object', 'ConvertFrom-Json', 'ConvertTo-Json', 'Copy-Item', 'ForEach-Object',
      'Get-ChildItem', 'Get-Content', 'Get-Date', 'Get-Item', 'Get-Member', 'Get-Process',
      'Group-Object', 'Join-Path', 'Measure-Object', 'New-Item', 'Out-File', 'Remove-Item',
      'Select-Object', 'Set-Content', 'Sort-Object', 'Split-Path', 'Start-Process',
      'Test-Path', 'Where-Object', 'Write-Error', 'Write-Host', 'Write-Output'
    ],
    members: EMPTY
  },

  swift: {
    keywords: [
      'associatedtype', 'as', 'break', 'case', 'catch', 'class', 'continue', 'default',
      'defer', 'deinit', 'do', 'else', 'enum', 'extension', 'fallthrough', 'fileprivate',
      'final', 'for', 'func', 'guard', 'if', 'import', 'in', 'init', 'inout', 'internal',
      'is', 'lazy', 'let', 'mutating', 'nil', 'open', 'private', 'protocol', 'public',
      'repeat', 'return', 'self', 'static', 'struct', 'subscript', 'switch', 'throw',
      'throws', 'try', 'typealias', 'var', 'where', 'while', 'true', 'false'
    ],
    builtins: [
      'Any', 'Array', 'Bool', 'Character', 'Codable', 'Dictionary', 'Double', 'Equatable',
      'Error', 'Hashable', 'Int', 'Optional', 'Result', 'Set', 'String', 'Void',
      'abs', 'max', 'min', 'print', 'zip'
    ],
    members: [
      'append', 'compactMap', 'contains', 'count', 'filter', 'first', 'flatMap', 'forEach',
      'hasPrefix', 'hasSuffix', 'isEmpty', 'joined', 'last', 'map', 'reduce', 'removeAll',
      'reversed', 'sorted', 'split', 'trimmingCharacters'
    ]
  }
}

/** Languages that borrow another's table wholesale, or extend it. */
const SHARES: Record<string, string> = { zsh: 'bash', sh: 'bash' }

/** TypeScript is JavaScript plus its own words, not a language on its own. */
const EXTENDS: Record<string, string> = { typescript: 'javascript' }

const MERGED = new Map<string, Vocabulary | null>()

/**
 * The vocabulary for a language id, or null when nothing is known about it.
 *
 * Null is a real answer and not a failure: a fence in a language Stone ships no
 * table for still gets the names declared in the note, which is the half of the
 * suggestion list that was worth having anyway.
 */
export function vocabFor(languageId: string): Vocabulary | null {
  const cached = MERGED.get(languageId)
  if (cached !== undefined) return cached

  const id = SHARES[languageId] ?? languageId
  const own = VOCAB[id] ?? null
  const base = EXTENDS[id] ? VOCAB[EXTENDS[id]] : null

  const merged: Vocabulary | null = !own
    ? null
    : !base
      ? own
      : {
          keywords: [...own.keywords, ...base.keywords],
          builtins: [...own.builtins, ...base.builtins],
          members: [...own.members, ...base.members]
        }

  MERGED.set(languageId, merged)
  return merged
}
