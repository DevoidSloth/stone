/**
 * Every kind of block a note can hold, described once.
 *
 * Stone's blocks are all the same thing on disk — three backticks and a word —
 * and completely different things to write. A `hash` block is six directives, a
 * `types` block is declarations, an `algo` block is a header and then a script
 * under a rule. Until now each of those was documented in the manual, seeded by
 * one entry in the slash menu, and understood by its own parser, with nothing
 * joining them up: the menu could not offer a second way into a fence, and
 * inside one there were no suggestions at all, because the editor's completion
 * knew about code and maths and treated everything else as a drawn box it had
 * no opinion about.
 *
 * This is that missing middle. One record per datatype holding three things:
 *
 *   presets    — starting points worth having, not just an empty fence
 *   keys/words — the vocabulary of the fence, for completion inside it
 *   docs       — where the manual explains it, to the section
 *
 * The slash menu, the in-block completion source and the **Explain this block**
 * command all read this table, which is what keeps them agreeing. A directive
 * added to a parser is added here in the same edit, and the menu, the
 * suggestion list and the manual link all learn about it at once.
 *
 * What is deliberately *not* here is the grammar itself. This table knows the
 * name of a directive and one line about what it does; the parser in `viz/`
 * remains the only thing that knows what the value means. A completion list
 * that tried to validate would be a second, worse parser drifting from the
 * first.
 */

import { CARET } from '../lib/latex'

/** A ready-made block, with `CARET` where the cursor should land. */
export interface DataPreset {
  label: string
  detail: string
  /** Extra words the slash menu should match, beyond the label and detail. */
  keywords: string
  /** The whole block, fence lines and all. */
  code: string
  /**
   * Shown before anything is typed. One per datatype: a bare `/` is a menu of
   * *kinds*, and eight variations of a hash table in it would bury the rest.
   * The others surface as soon as the query names the fence — `/hash`, `/probe`
   * — which is the moment someone is looking for a variation rather than a
   * block.
   */
  headline?: boolean
}

/** One of a fixed set of values a directive accepts. */
export interface DataValue {
  label: string
  detail: string
}

/** A `key: value` line at the top of a block. */
export interface DataKey {
  key: string
  detail: string
  /** What a value looks like, shown in the suggestion's preview. */
  sample?: string
  /** The longer explanation, for the panel beside the list. */
  info?: string
  /** Offered after the colon, when the key takes one of a few words. */
  values?: DataValue[]
  /** Sorts above the rest — the directives that are the point of the fence. */
  boost?: number
}

/** A word that starts a body line: an `algo` step, a `types` declaration. */
export interface DataWord {
  word: string
  detail: string
  /** The rest of the line, as a shape: `i j`, `Name extends Super`. */
  sample?: string
  info?: string
  boost?: number
}

export interface Datatype {
  id: string
  /** The fence word. Null for the blocks that have no fence: tables, `$$`. */
  fence: string | null
  label: string
  blurb: string
  /** Where the manual explains it. The section title must match exactly. */
  docs: { topic: string; section?: string }
  presets: DataPreset[]
  keys?: DataKey[]
  words?: DataWord[]
  /**
   * `algo` only: steps live under the `---` rule, and the directives above it.
   * Offering `swap` where `array:` belongs is worse than offering nothing.
   */
  wordsBelowRule?: boolean
  /** Whether `*`, `~`, `#red` and `| text` mean anything here. */
  annotated?: boolean
}

/** A block, written as its own text. Keeps backtick runs out of the table. */
function fence(lang: string, body: string): string {
  return ['```' + lang, body, '```'].join('\n')
}

// The annotations every program figure shares. Written once and pointed at
// from each fence's headline directive, because a person who learns `*` on a
// tree expects it to work on a list, and it does.
const ANNOTATIONS = 'After any label: `*` rings it, `~` fades it, `#red` colours it, `| text` writes a second line under it.'

const TITLE: DataKey = { key: 'title', detail: 'A line above the figure', sample: 'What this shows' }
const CAPTION: DataKey = { key: 'caption', detail: 'A line below it', sample: 'What to notice' }

/** The accent names `#red` and friends resolve to — see `viz/svg`. */
export const ACCENTS: DataValue[] = [
  { label: 'red', detail: 'Colours it red' },
  { label: 'green', detail: 'Colours it green' },
  { label: 'blue', detail: 'Colours it with the accent' },
  { label: 'yellow', detail: 'Colours it yellow' },
  { label: 'purple', detail: 'Colours it purple' },
  { label: 'gray', detail: 'Fades it to the faint text colour' }
]

export const DATATYPES: Datatype[] = [
  // ------------------------------------------------------------------- tree
  {
    id: 'tree',
    fence: 'tree',
    label: 'Tree',
    blurb: 'Binary trees, heaps and BSTs, from the arrays they arrive as.',
    docs: { topic: 'figures', section: 'tree — shapes that arrive as arrays' },
    annotated: true,
    presets: [
      {
        label: 'Tree',
        detail: 'A binary tree, heap, or BST, from an array',
        keywords: 'tree binary bst heap node traversal inorder leetcode',
        headline: true,
        code: fence('tree', `level: 5 3 8 2 4 . 9${CARET}`)
      },
      {
        label: 'Tree — binary search tree',
        detail: 'Inserted in the order you give, with the walk numbered',
        keywords: 'bst binary search tree insert inorder sorted',
        code: fence('tree', 'bst: 50 30 70 20 40 60 80\ntraverse: inorder')
      },
      {
        label: 'Tree — binary heap',
        detail: 'An array as a complete tree, indices labelled',
        keywords: 'heap priority queue array complete sift',
        code: fence('tree', 'heap: 9 7 8 3 5 1\ncaption: The array, as the tree it stands for')
      },
      {
        label: 'Tree — an outline',
        detail: 'A parse tree, a trie — anything not an array',
        keywords: 'outline parse expression trie indent arbitrary',
        code: fence('tree', `title: An expression tree\n*\n  +\n    3\n    4\n  5${CARET}`)
      },
      {
        label: 'Tree — a rotation',
        detail: 'Before and after, with the two nodes that swapped ringed',
        keywords: 'rotate rotation avl red black balance rebalance zig zag pivot balanced',
        code: fence('tree', `bst: 50 30 70 20 40\nrotate: right 50${CARET}`)
      },
      {
        label: 'Recursion tree',
        detail: 'A recurrence, unrolled, with what each level costs',
        keywords:
          'recurrence recursion tree master theorem cost level mergesort divide conquer complexity solve big-o',
        code: fence('tree', `recurrence: 2T(n/2) + n${CARET}`)
      },
      {
        label: 'Recursion tree — subtractive',
        detail: 'A chain rather than a fan, and the sum under it',
        keywords: 'recurrence subtractive chain quicksort worst case n-1',
        code: fence('tree', 'recurrence: T(n-1) + n\ntotal: Θ(n²)')
      }
    ],
    keys: [
      {
        key: 'bst',
        detail: 'Insert these in order; equal keys go right',
        sample: '50 30 70 20 40',
        boost: 3,
        info: `Builds a binary search tree by inserting left to right, so the shape is a fact about the order rather than about the set. ${ANNOTATIONS}`
      },
      {
        key: 'heap',
        detail: 'An array read as a complete binary tree',
        sample: '9 7 8 3 5 1',
        boost: 3,
        info: 'Index `i` has children `2i+1` and `2i+2`, and the figure labels them, which is the part that never survives being written on a whiteboard.'
      },
      {
        key: 'level',
        detail: 'Level order, `.` for a missing child',
        sample: '1 2 3 . . 4 5',
        boost: 3,
        info: 'The LeetCode form. An empty slot is drawn rather than omitted, so a node with one child leans the way it should.'
      },
      {
        key: 'traverse',
        detail: 'Number the nodes in visit order',
        sample: 'inorder',
        boost: 2,
        values: [
          { label: 'inorder', detail: 'Left, node, right — sorted, for a BST' },
          { label: 'preorder', detail: 'Node, left, right' },
          { label: 'postorder', detail: 'Left, right, node' },
          { label: 'level', detail: 'Breadth first, row by row' }
        ]
      },
      {
        key: 'recurrence',
        detail: 'Unroll a recurrence into the tree it describes',
        sample: '2T(n/2) + n',
        boost: 2,
        info: 'Give it the right-hand side. The levels are worked out exactly and summed by the master theorem, with the case it fell into as the caption.'
      },
      {
        key: 'rotate',
        detail: 'Draw the tree, and the same tree after one rotation',
        sample: 'right 50',
        boost: 2,
        info: 'The operation every balanced tree is built out of, and the one hardest to believe from a description: three pointers move, the in-order sequence does not change, and one side gets shorter. Both ends of the moved edge are ringed in each half.'
      },
      { key: 'depth', detail: 'How many levels below the root', sample: '4' },
      { key: 'cost', detail: 'Write the level costs yourself', sample: 'n, n/2, n/4' },
      { key: 'total', detail: 'The line under the rule', sample: 'Θ(n log n)' },
      TITLE,
      CAPTION
    ]
  },

  // ------------------------------------------------------------------ graph
  {
    id: 'graph',
    fence: 'graph',
    label: 'Graph',
    blurb: 'Nodes, edges, and what it costs to cross them.',
    docs: { topic: 'figures', section: 'graph — the ones that refused to be a tree' },
    annotated: true,
    presets: [
      {
        label: 'Graph',
        detail: 'Nodes, weighted edges, and the arrows between them',
        keywords: 'graph node edge vertex weighted directed digraph network adjacency',
        headline: true,
        code: fence('graph', `a -> b: 4\na -> c: 2\nc -> b: 1\nb -> d: 5\nc -> d: 8${CARET}`)
      },
      {
        label: 'Graph — a map',
        detail: 'Undirected, weighted, laid out by what it connects to what',
        keywords: 'undirected map road distance mst kruskal prim spanning',
        code: fence(
          'graph',
          'title: Distances\nIthaca -- Syracuse: 57\nIthaca -- Binghamton: 49\nSyracuse -- Rochester: 87\nBinghamton -- Syracuse: 72'
        )
      },
      {
        label: 'Graph — a shortest path',
        detail: 'The route picked out, with its cost worked out for you',
        keywords: 'shortest path dijkstra route highlight cost total bellman ford',
        code: fence('graph', `path: a c d\na -> b: 7\na -> c: 2\nc -> d: 3\nb -> d: 1${CARET}`)
      },
      {
        label: 'Graph — a state machine',
        detail: 'A DFA: an entry arrow, self-loops, and a double-ringed accepting state',
        keywords: 'dfa nfa automaton state machine regular expression accept start transition regex',
        code: fence(
          'graph',
          'layout: layered\nstart: q0\naccept: q2\nq0 -> q0: 0\nq0 -> q1: 1\nq1 -> q2: 1\nq1 -> q0: 0\nq2 -> q2: 0 1'
        )
      },
      {
        label: 'Graph — a dependency order',
        detail: 'A DAG, left to right, in layers',
        keywords: 'dag dependency topological sort order layered prerequisite build',
        code: fence(
          'graph',
          'layout: layered\nstart: parse\nparse -> check\ncheck -> optimise\ncheck -> emit\noptimise -> emit'
        )
      },
      {
        label: 'Graph — a dense one, in a ring',
        detail: 'Everything on one circle, when a spring layout is a hairball',
        keywords: 'circle ring dense complete clique layout k5',
        code: fence('graph', `layout: circle\na -- b\nb -- c\nc -- d\nd -- e\ne -- a\na -- c\nb -- d${CARET}`)
      }
    ],
    keys: [
      {
        key: 'layout',
        detail: 'How the nodes are placed',
        sample: 'spring',
        boost: 3,
        values: [
          { label: 'spring', detail: 'Repulsion and attraction, run to a standstill — the default' },
          { label: 'circle', detail: 'Everything on one ring, in the order written' },
          { label: 'layered', detail: 'Breadth-first from `start:`, left to right' }
        ],
        info: 'Nothing in the source positions anything. The spring layout is seeded from a circle and has no randomness in it, so the same graph is the same picture every time it is drawn.'
      },
      {
        key: 'path',
        detail: 'Light a route through, and add up what it cost',
        sample: 'a c d',
        boost: 3,
        info: 'Names the nodes in order. The edges between consecutive ones light too, and the caption carries the total when every weight on the way is a number.'
      },
      { key: 'start', detail: 'An entry arrow, and where `layered` begins', sample: 'q0', boost: 2 },
      { key: 'accept', detail: 'Accepting states — a second ring inside the first', sample: 'q2', boost: 2 },
      { key: 'directed', detail: 'Arrows, whatever the edges were written with' },
      { key: 'undirected', detail: 'No arrows, whatever they were written with' },
      TITLE,
      CAPTION
    ],
    words: [
      {
        word: '(an edge)',
        detail: '`a -> b`, with `: 4` for a weight',
        sample: 'a -> b: 4',
        boost: 3,
        info: 'A node exists as soon as an edge mentions it. `<-` is the same edge written backwards. Spaces around the arrow let a node be called `state-1`.'
      },
      {
        word: '(an undirected edge)',
        detail: 'No arrowhead — `a -- b`',
        sample: 'a -- b: 7',
        boost: 2,
        info: 'One arrow anywhere in the block makes the whole graph directed; `undirected:` overrules that.'
      },
      {
        word: '(a node on its own)',
        detail: 'An isolated vertex, or somewhere to hang an annotation',
        sample: 'a | 0',
        boost: 1,
        info: 'The part after `|` is a second line under the name — a distance, a colour class, a degree.'
      }
    ]
  },

  // ------------------------------------------------------------------- list
  {
    id: 'list',
    fence: 'list',
    label: 'Linked list',
    blurb: 'A chain of nodes, and the pointers walking it.',
    docs: { topic: 'figures', section: 'list — a chain of nodes' },
    annotated: true,
    presets: [
      {
        label: 'Linked list',
        detail: 'A chain of nodes, and the pointers walking it',
        keywords: 'linked list chain node next link singly head tail',
        headline: true,
        code: fence('list', `head: 1 2 3${CARET}`)
      },
      {
        label: 'Linked list — doubly linked',
        detail: 'A prev slot on every node, and the links back',
        keywords: 'doubly double linked prev backward two way',
        code: fence('list', 'doubly:\nhead: 1 2 3 4')
      },
      {
        label: 'Linked list — a cycle',
        detail: 'The last link rejoins part-way along',
        keywords: 'circular cycle loop floyd tortoise hare detect rho',
        code: fence('list', 'head: 1 2 3 4 5 6\ncircular: 2\ncaption: The shape a cycle-finding walk is looking for')
      },
      {
        label: 'Linked list — reversing in place',
        detail: 'Two pointers over one chain, mid-reversal',
        keywords: 'reverse in place prev curr pointer walk',
        code: fence(
          'list',
          `title: Reversing in place\nhead: 1 -> 2 * -> 3 ~\nat prev 0 #gray\nat curr 1 #red${CARET}`
        )
      }
    ],
    keys: [
      {
        key: 'head',
        detail: 'The chain, with `head` pointing into the first node',
        sample: '1 2 3',
        boost: 3,
        info: `The name before the colon labels the arrow in, so \`front:\` and \`curr:\` work as well. Values are separated by spaces, commas or arrows. ${ANNOTATIONS}`
      },
      { key: 'list', detail: 'The same chain, with nothing pointing at it', sample: '1 -> 2 -> 3', boost: 2 },
      { key: 'doubly', detail: 'A prev slot on every node, and the links back', boost: 2 },
      {
        key: 'circular',
        detail: 'The last link goes round to the front',
        sample: '2',
        boost: 2,
        info: 'Bare, it rejoins the front. `circular: 2` rejoins at that position instead, which is the ρ shape rather than a ring.'
      },
      TITLE,
      CAPTION
    ],
    words: [
      {
        word: 'at',
        detail: 'A named pointer above a node',
        sample: 'curr 1',
        boost: 2,
        info: 'Counting from 0, and `-1` is the last node. Two pointers on one node stack rather than draw over each other, and each takes its own `#colour`.'
      }
    ]
  },

  // ----------------------------------------------------------------- memory
  {
    id: 'memory',
    fence: 'memory',
    label: 'Memory diagram',
    blurb: 'Stack frames, heap objects, and the pointers between them.',
    docs: { topic: 'figures', section: 'memory — stack, heap and pointers' },
    annotated: true,
    presets: [
      {
        label: 'Memory diagram',
        detail: 'Stack frames, heap objects, and the pointers between them',
        keywords: 'memory pointer heap stack struct node linked list reference diagram',
        headline: true,
        code: fence(
          'memory',
          `stack:\n  main:\n    head -> n1\nheap:\n  n1 Node { val: 1, next -> n2 }\n  n2 Node { val: 2, next: null }${CARET}`
        )
      },
      {
        label: 'Memory — mid-reversal',
        detail: 'A frame, three pointers, and a chain that is half turned round',
        keywords: 'reverse linked list prev curr next frame locals',
        code: fence(
          'memory',
          'title: Reversing a linked list\nstack:\n  reverse(head):\n    prev -> null\n    curr -> n2 *\nheap:\n  n1 Node { val: 1, next: null }\n  n2 Node { val: 2, next -> n1 }\n  n3 Node { val: 3, next -> n2 }'
        )
      },
      {
        label: 'Cons list',
        detail: 'SICP-style pairs, one line',
        keywords: 'cons pair lisp scheme sicp cdr car list',
        code: fence('memory', `pairs: 1 2 3${CARET}`)
      },
      {
        label: 'Memory — an array',
        detail: 'One box, slots numbered underneath',
        keywords: 'array slots indices buffer contiguous',
        code: fence('memory', `array: nums = 3, 1, 4, 1, 5${CARET}`)
      }
    ],
    keys: [
      {
        key: 'stack',
        detail: 'The frames, written as `name:` with their locals indented',
        boost: 3,
        info: 'Nothing is positioned. The heap lays itself out by following its own pointers, so a chain comes out as a chain and a tree as a fan, with no coordinates in the source.'
      },
      { key: 'heap', detail: 'The objects, one `id Type { … }` a line', boost: 3 },
      { key: 'globals', detail: 'Statics — the third region', boost: 2 },
      { key: 'list', detail: 'A chain of Node objects, in one line', sample: '1 2 3', boost: 2 },
      { key: 'pairs', detail: 'Cons cells, in one line', sample: '1 2 3', boost: 2 },
      { key: 'array', detail: 'A named array, slots numbered', sample: 'nums = 3, 1, 4' },
      TITLE,
      CAPTION
    ]
  },

  // ------------------------------------------------------------------ boxes
  {
    id: 'boxes',
    fence: 'boxes',
    label: 'Box and pointer',
    blurb: 'Variables, objects, and what points at what.',
    docs: { topic: 'figures', section: 'boxes — what refers to what' },
    annotated: true,
    presets: [
      {
        label: 'Box and pointer',
        detail: 'Variables, objects, and what points at what',
        keywords: 'box pointer object reference variable java python heap field array list',
        headline: true,
        // The rows are part of the preset because the figure refuses a pointer
        // to a box that does not exist — as it should, since a dangling `->r0`
        // is the one mistake a reader could not spot in the drawing.
        code: fence(
          'boxes',
          `b -> board\n\nboard CBoard:\n  cells -> grid\n\ngrid Int[][] [ ->r0, ->r1 ]\n\nr0 Int[] [ 1, 2, 3 ]\nr1 Int[] [ 4, 5, 6 ]${CARET}`
        )
      },
      {
        label: 'Box and pointer — aliasing',
        detail: 'Two names, one object — the picture that settles the argument',
        keywords: 'alias aliasing reference copy shallow same object identity',
        code: fence('boxes', 'a -> p\nb -> p\n\np Point { x: 3, y: 4 }')
      },
      {
        label: 'Box and pointer — a list of objects',
        detail: 'A column: the type, the length, then one row an element',
        keywords: 'list arraylist elements column collection',
        code: fence('boxes', 'people -> roster\n\nroster List [ ->p1, ->p2 ]\n\np1 Person { name: "Ada" }\np2 Person { name: "Alan" }')
      }
    ],
    keys: [
      { key: 'array', detail: 'A named array, slots numbered', sample: 'nums = 3, 1, 4' },
      TITLE,
      CAPTION
    ],
    words: [
      {
        word: '(a variable)',
        detail: '`name -> target`, or `name = 5` for a value',
        sample: 'x -> obj',
        info: 'A small box with its name outside it. There is no stack and no heap here — those are facts about storage, and this picture is about references.'
      },
      {
        word: '(an object)',
        detail: '`id Type:` with fields indented, or `id Type { … }`',
        sample: 'p Point { x: 3, y: 4 }',
        info: 'The title drawn is the type; the `id` is only how other lines point at it, and never appears in the figure.'
      }
    ]
  },

  // ------------------------------------------------------------------ types
  {
    id: 'types',
    fence: 'types',
    label: 'Type hierarchy',
    blurb: 'Classes and interfaces, and what extends what.',
    docs: { topic: 'figures', section: 'types — a hierarchy of classes and interfaces' },
    annotated: true,
    presets: [
      {
        label: 'Type hierarchy',
        detail: 'Classes and interfaces, and what extends what',
        keywords:
          'types type hierarchy class interface inheritance extends implements subtype uml design document abstract',
        headline: true,
        code: fence(
          'types',
          `abstract class Animal\ninterface Winged\nclass Dog extends Animal\nclass Bird extends Animal implements Winged${CARET}`
        )
      },
      {
        label: 'Type hierarchy — with members',
        detail: 'Fields and methods, in a compartment under each type',
        keywords: 'members fields methods compartment signature api interface',
        code: fence(
          'types',
          'title: Ciphers\ninterface Cipher\n  encrypt(String): String\n  decrypt(String): String\nabstract class Substitution implements Cipher\n  alphabet: char[]\nclass Caesar extends Substitution\nclass Vigenere extends Substitution\n  key: String'
        )
      },
      {
        label: 'Type hierarchy — the short form',
        detail: '`Dog < Animal`: a subtype of both, in one line each',
        keywords: 'short form subtype shorthand quick sketch',
        code: fence('types', `class Bird < Animal, Winged${CARET}`)
      }
    ],
    keys: [TITLE, CAPTION],
    words: [
      { word: 'class', detail: 'A plain box', sample: 'Dog extends Animal', boost: 3 },
      {
        word: 'abstract class',
        detail: 'The name in italics, `abstract class` under it',
        sample: 'Animal',
        boost: 2
      },
      {
        word: 'interface',
        detail: 'A dashed box',
        sample: 'Winged',
        boost: 2,
        info: 'The arrowhead is UML’s hollow triangle and always points at the supertype, so the figure says which way the relation runs without a legend.'
      },
      { word: 'enum', detail: 'A dashed box, like an interface', sample: 'Suit' },
      { word: 'record', detail: 'A dashed box, like an interface', sample: 'Point(int x, int y)' },
      { word: 'extends', detail: 'A solid edge up to the supertype', sample: 'Animal', boost: 1 },
      { word: 'implements', detail: 'A dashed edge — realising, not extending', sample: 'Winged', boost: 1 }
    ]
  },

  // ------------------------------------------------------------------- hash
  {
    id: 'hash',
    fence: 'hash',
    label: 'Hash table',
    blurb: 'Buckets, chains and collisions, worked out for you.',
    docs: { topic: 'figures', section: 'hash — a table, with the collisions in it' },
    annotated: true,
    presets: [
      {
        label: 'Hash table',
        detail: 'Buckets, chains and collisions, worked out for you',
        keywords: 'hash table bucket chain collision probe load factor rehash map dictionary',
        headline: true,
        code: fence('hash', `buckets: 7\nkeys: 12 44 13 88 23 94 11${CARET}`)
      },
      {
        label: 'Hash table — linear probing',
        detail: 'Open addressing, with an arc from wanted to settled for',
        keywords: 'linear probing open addressing cluster arc probe count',
        code: fence('hash', 'buckets: 8\nprobe: linear\nkeys: 12 20 28 5 13')
      },
      {
        label: 'Hash table — quadratic probing',
        detail: 'The same walk, stepping 1, 4, 9 away',
        keywords: 'quadratic probing open addressing cluster secondary',
        code: fence('hash', 'buckets: 11\nprobe: quadratic\nkeys: 20 31 42 9 53')
      },
      {
        label: 'Hash table — string keys',
        detail: "Java's `String.hashCode`, so the figure is really a HashMap",
        keywords: 'string keys java hashcode words dictionary',
        code: fence('hash', 'buckets: 8\nhash: java\nkeys: apple banana cherry damson elder\nshow: hash')
      },
      {
        label: 'Hash table — rehashing',
        detail: 'Double the table when it passes the load factor',
        keywords: 'load factor rehash resize grow double amortised',
        code: fence('hash', 'buckets: 4\nload: 0.75\nkeys: 5 12 19 23 7 15')
      },
      {
        label: 'Hash table — written by hand',
        detail: 'The buckets from a book, rather than computed',
        keywords: 'by hand written literal book exercise given',
        code: fence('hash', `0:\n1: apple banana\n2:\n3: cherry${CARET}`)
      }
    ],
    keys: [
      {
        key: 'keys',
        detail: 'Inserted in this order',
        sample: '12 44 13 88',
        boost: 3,
        info: 'The one figure that computes: it hashes the keys, resolves the collisions and draws where they actually went, which is never where you guessed.'
      },
      { key: 'buckets', detail: 'How big the table is — 8 by default', sample: '7', boost: 3 },
      {
        key: 'probe',
        detail: 'How a collision is dealt with',
        sample: 'chain',
        boost: 2,
        values: [
          { label: 'chain', detail: 'Separate chaining — a list per bucket' },
          { label: 'linear', detail: 'Open addressing, one step at a time' },
          { label: 'quadratic', detail: 'Open addressing, stepping 1, 4, 9 away' },
          { label: 'double', detail: 'Open addressing, with a second hash for the step' }
        ]
      },
      {
        key: 'hash',
        detail: 'Which hash function — guessed from the keys',
        sample: 'mod',
        boost: 2,
        values: [
          { label: 'mod', detail: '`k mod m` — for numbers' },
          { label: 'java', detail: "Java's `String.hashCode`" },
          { label: 'length', detail: 'The length of the key' },
          { label: 'first', detail: 'The first character' },
          { label: 'sum', detail: 'The characters, added up' }
        ]
      },
      { key: 'load', detail: 'Double and rehash past this fullness', sample: '0.75' },
      { key: 'remove', detail: 'Delete a key — leaves a tombstone', sample: '44' },
      {
        key: 'show',
        detail: "Write each key's raw hash under it",
        sample: 'hash',
        values: [{ label: 'hash', detail: 'The number before it was reduced' }]
      },
      TITLE,
      CAPTION
    ]
  },

  // ------------------------------------------------------------------ chart
  {
    id: 'chart',
    fence: 'chart',
    label: 'Chart',
    blurb: 'Growth curves, or timings you measured.',
    docs: { topic: 'figures', section: 'chart — growth, predicted or measured' },
    presets: [
      {
        label: 'Chart',
        detail: 'Growth curves, or timings you measured',
        keywords: 'chart plot graph growth curve big-o complexity benchmark timing measure axis log data',
        headline: true,
        code: fence('chart', `x: 1..64\nn\nn log n\nn^2${CARET}`)
      },
      {
        label: 'Chart — big-O, drawn',
        detail: 'The definition: f under c·g from n₀ on',
        keywords: 'big-o definition bound n0 constant crossover proof asymptotic',
        code: fence('chart', 'x: 1..40\nmark: 14 n₀\nf = 3n + 40\ncg = n^2 / 4')
      },
      {
        label: 'Chart — measured timings',
        detail: 'Readings, drawn dashed with dots, against a predicted curve',
        keywords: 'measured benchmark timings readings experiment data dashed',
        code: fence(
          'chart',
          `x: 1000 2000 4000 8000 16000\nmeasured: 12 26 55 118 240\nxlabel: n\nylabel: ms${CARET}`
        )
      },
      {
        label: 'Chart — log-log axes',
        detail: 'A polynomial becomes a straight line whose slope is its exponent',
        keywords: 'log log logarithmic axes slope exponent straight line scale',
        code: fence('chart', 'x: 1..1024\nlog: xy\nn\nn log n\nn^2')
      },
      {
        label: 'Chart — bars',
        detail: 'Four measurements, side by side',
        keywords: 'bars bar chart columns compare categories',
        code: fence('chart', `bars:\nx: 1 2 3 4\nbefore: 40 38 41 39\nafter: 12 11 13 12${CARET}`)
      }
    ],
    keys: [
      {
        key: 'x',
        detail: 'The domain',
        sample: '1..64',
        boost: 3,
        info: 'A range like `1..64`, or the points named one by one — `x: 1 2 4 8`. A series is either an expression in `n` or a row of numbers, and both draw on the same axes.'
      },
      { key: 'y', detail: 'Fix the vertical range', sample: '0..500', boost: 2 },
      {
        key: 'log',
        detail: 'Logarithmic axes',
        sample: 'xy',
        boost: 2,
        values: [
          { label: 'xy', detail: 'Both axes' },
          { label: 'x', detail: 'The horizontal one' },
          { label: 'y', detail: 'The vertical one' }
        ]
      },
      { key: 'mark', detail: 'A rule across, labelled', sample: '14 n₀', boost: 2 },
      { key: 'bars', detail: 'Bars rather than lines', boost: 1 },
      { key: 'points', detail: 'A dot at every reading' },
      { key: 'xlabel', detail: 'Name the horizontal axis — `n` unless you say', sample: 'n' },
      { key: 'ylabel', detail: 'Name the vertical axis', sample: 'ms' },
      { key: 'width', detail: 'How wide, in points', sample: '440' },
      { key: 'height', detail: 'How tall, in points', sample: '240' },
      TITLE,
      CAPTION
    ],
    words: [
      {
        word: '(a curve)',
        detail: 'An expression in `n`, labelled with itself',
        sample: 'n^2 / 4',
        boost: 1,
        info: 'Juxtaposition is multiplication, so `n log n` is what it looks like, and `log` is base two. Also: ln, log10, sqrt, exp, abs, floor, ceil. `f = 3n + 40` is the same curve, named.'
      },
      {
        word: '(a series)',
        detail: 'A row of numbers, drawn dashed with dots',
        sample: 'measured: 12 26 55',
        info: 'The name before the colon labels the line at its right-hand end rather than in a legend, so reading it costs no round trip to a key.'
      }
    ]
  },

  // ------------------------------------------------------------------- algo
  {
    id: 'algo',
    fence: 'algo',
    label: 'Algorithm run',
    blurb: 'A structure and the steps over it, played back.',
    docs: { topic: 'figures', section: 'algo — an algorithm, running' },
    annotated: true,
    wordsBelowRule: true,
    presets: [
      {
        label: 'Algorithm run',
        detail: 'An array and the steps, played back',
        keywords: 'algorithm animation sort search step trace array stack queue playback',
        headline: true,
        code: fence('algo', `array: 5 3 8 1\n---\ncompare 0 1\nswap 0 1\nnote ${CARET}`)
      },
      {
        label: 'Algorithm run — bubble sort',
        detail: 'The walk, with the tail marked sorted as it grows',
        keywords: 'bubble sort swap pass sorted suffix trace',
        code: fence(
          'algo',
          'title: Bubble sort\narray: 5 3 8 1 9\nspeed: 500\n---\nnote Walk the pairs, swapping any out of order\ncompare 0 1\nswap 0 1\ncompare 1 2\ncompare 2 3\nswap 2 3\nmark 4 sorted'
        )
      },
      {
        label: 'Algorithm run — binary search',
        detail: 'Two pointers closing on a target',
        keywords: 'binary search two pointer lo hi mid halve sorted',
        code: fence(
          'algo',
          'title: Binary search for 23\narray: 2 5 8 12 16 23 38 56 72\n---\nat lo 0\nat hi 8\nrange window 0 8\nat mid 4\ncompare 4 4\nnote 16 < 23 — go right\nat lo 5\nrange window 5 8\nat mid 6'
        )
      },
      {
        label: 'Algorithm run — a stack',
        detail: 'Push and pop, drawn vertically',
        keywords: 'stack push pop lifo frames parenthesis matching',
        code: fence('algo', `stack:\n---\npush a\npush b\npop\npush c${CARET}`)
      },
      {
        label: 'Algorithm run — a queue',
        detail: 'Enqueue and dequeue, in at one end and out at the other',
        keywords: 'queue enqueue dequeue fifo bfs ring',
        code: fence('algo', `queue:\n---\nenqueue 1\nenqueue 2\ndequeue\nenqueue 3${CARET}`)
      },
      {
        label: 'Algorithm run — a traversal',
        detail: 'Over a tree, addressed by the labels rather than by index',
        keywords: 'traversal tree visit inorder dfs bfs walk',
        code: fence('algo', 'title: Inorder\nlevel: 5 3 8 2 4 7 9\n---\nvisit 2\nvisit 3\nvisit 4\nvisit 5')
      },
      {
        label: 'Algorithm run — breadth-first search',
        detail: 'A graph, a frontier, and the order the walk reaches things',
        keywords: 'bfs breadth first search graph frontier queue traversal shortest unweighted level',
        code: fence(
          'algo',
          'title: Breadth-first from a\ngraph:\na -> b: 1\na -> c: 1\nb -> d: 1\nc -> d: 1\nd -> e: 1\n---\nvisit a\nnote Take a, and add what it reaches\ncompare a b\nmark b frontier\ncompare a c\nmark c frontier\nvisit b\ncompare b d\nmark d frontier\nvisit c\nvisit d\nvisit e'
        )
      },
      {
        label: "Algorithm run — Dijkstra's algorithm",
        detail: 'The distance under each node, falling as the edges are relaxed',
        keywords: 'dijkstra shortest path relax distance priority queue graph weighted sssp',
        code: fence(
          'algo',
          `title: Dijkstra from s\ngraph:\nlayout: circle\ns -> a: 4\ns -> b: 1\nb -> a: 2\na -> t: 5\nb -> t: 8\n---\nset s 0\nvisit s\ncompare s b\nset b 1\ncompare s a\nset a 4\nvisit b\ncompare b a\nset a 3\nnote 3 beats 4 — the way round is shorter${CARET}`
        )
      },
      {
        label: 'Algorithm run — depth-first search',
        detail: 'One branch to the end, then back up',
        keywords: 'dfs depth first search graph stack backtrack recursion traversal',
        code: fence(
          'algo',
          'graph:\nlayout: layered\nstart: a\na -> b\na -> c\nb -> d\nd -> e\nc -> e\n---\nvisit a\nvisit b\nvisit d\nvisit e\nnote The end of this branch — back up\nvisit c'
        )
      },
      {
        label: 'Loop invariant',
        detail: 'Three stills: on entry, held, on exit',
        keywords: 'loop invariant still frame proof correctness entry exit sorted prefix range boundary',
        code: fence(
          'algo',
          `array: 5 3 8 1 9 2\nstills: 0 -1\n---\nrange sorted 0 0\nnote On entry: nothing is sorted\nmark 0..5 sorted\nrange sorted 0 5\nnote On exit: all of it is sorted${CARET}`
        )
      }
    ],
    keys: [
      {
        key: 'array',
        detail: 'The structure the steps run over',
        sample: '5 3 8 1 9',
        boost: 3,
        info: 'One structure a block, then a `---` rule, then one step a line. Every step is a frame, and the transport under the figure plays, steps and scrubs them.'
      },
      { key: 'stack', detail: 'A stack — drawn vertically, push and pop', boost: 2 },
      { key: 'queue', detail: 'A queue — in at one end, out at the other', boost: 2 },
      { key: 'list', detail: 'A chain of nodes rather than a row of slots', boost: 2 },
      { key: 'bst', detail: 'A tree, built by insertion, for a traversal', sample: '50 30 70', boost: 2 },
      { key: 'heap', detail: 'A tree from a heap array', sample: '9 7 8 3' },
      { key: 'level', detail: 'A tree in level order', sample: '5 3 8 2 4' },
      {
        key: 'graph',
        detail: 'A graph — written as edges above the `---` rule',
        boost: 2,
        info: 'The one structure written as lines rather than as a value, so the rule stops being decoration and becomes the split: edges above it, steps below. `compare a b` lights the edge between them, and `set b 4` writes a distance under a node.'
      },
      { key: 'layout', detail: 'How a graph is laid out — spring, circle, layered', sample: 'circle' },
      { key: 'start', detail: 'In a graph, the entry arrow and where `layered` begins', sample: 'a' },
      { key: 'accept', detail: 'In a graph, the double-ringed states', sample: 'q2' },
      {
        key: 'stills',
        detail: 'A strip of frozen frames instead of a transport',
        sample: '0 -1',
        boost: 2,
        info: 'A loop invariant is not an animation but three pictures — on entry, held, on exit — and the argument is what stayed true across them. Bare, it picks the frames carrying a `note`, plus the ends.'
      },
      { key: 'speed', detail: 'Milliseconds a frame is held', sample: '500' },
      { key: 'autoplay', detail: 'Start without being asked', sample: 'true' },
      { key: 'loop', detail: 'Run it round again', sample: 'true' },
      TITLE,
      CAPTION
    ],
    words: [
      { word: 'compare', detail: 'Lights those slots for one frame', sample: 'i j', boost: 3 },
      { word: 'swap', detail: 'Swaps them', sample: 'i j', boost: 3 },
      { word: 'set', detail: 'Writes a value', sample: 'i v', boost: 2 },
      {
        word: 'mark',
        detail: 'A lasting mark',
        sample: 'i sorted',
        boost: 2,
        info: '`mark 0..3 done` marks a span. The word is yours — it names the mark and colours it consistently.'
      },
      { word: 'unmark', detail: 'Takes it off — `unmark all` clears them', sample: 'i', boost: 1 },
      {
        word: 'at',
        detail: 'A named pointer under a slot',
        sample: 'lo 0',
        boost: 2,
        info: '`at lo off` removes it again. Pointers stack rather than draw over each other.'
      },
      {
        word: 'range',
        detail: 'A bracket over a span',
        sample: 'window 2 5',
        boost: 2,
        info: 'A name before the bounds labels it; `range window off` takes it away.'
      },
      { word: 'note', detail: 'The caption for this frame onward', sample: 'What just happened', boost: 3 },
      { word: 'visit', detail: "In a tree, addressed by the node's label", sample: '7', boost: 1 },
      { word: 'push', detail: 'Onto a stack — `enqueue` for a queue', sample: 'v', boost: 1 },
      { word: 'pop', detail: 'Off a stack — `dequeue` for a queue', boost: 1 },
      { word: 'insert', detail: 'A new slot at a position', sample: 'i v' },
      { word: 'remove', detail: 'Takes a slot out', sample: 'i' },
      { word: 'hold', detail: 'A frame where nothing changes' },
      { word: 'clear', detail: 'Empties the structure' }
    ]
  },

  // ---------------------------------------------------------------- mermaid
  {
    id: 'mermaid',
    fence: 'mermaid',
    label: 'Diagram',
    blurb: 'Mermaid: flowcharts, sequences, state machines and more.',
    docs: { topic: 'writing', section: 'Diagrams and drawings' },
    presets: [
      {
        label: 'Diagram',
        detail: 'A Mermaid flowchart',
        keywords: 'mermaid chart flow graph diagram',
        headline: true,
        code: fence('mermaid', `flowchart TD\n  A[Start] --> B[${CARET}]`)
      },
      {
        label: 'Diagram — decision flow',
        detail: 'A branch, and the two ways out of it',
        keywords: 'flowchart decision branch if else yes no condition',
        code: fence(
          'mermaid',
          'flowchart TD\n  A[Read the input] --> B{Valid?}\n  B -- yes --> C[Handle it]\n  B -- no --> D[Report the error]\n  C --> E[Done]\n  D --> E'
        )
      },
      {
        label: 'Diagram — sequence',
        detail: 'Who calls whom, and in what order',
        keywords: 'sequence diagram messages actors calls protocol handshake',
        code: fence(
          'mermaid',
          `sequenceDiagram\n  participant Client\n  participant Server\n  Client->>Server: GET /notes\n  Server-->>Client: 200 OK${CARET}`
        )
      },
      {
        label: 'Diagram — state machine',
        detail: 'States, and what moves between them',
        keywords: 'state machine states transitions fsm automaton',
        code: fence(
          'mermaid',
          'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running: start\n  Running --> Idle: stop\n  Running --> [*]: quit'
        )
      },
      {
        label: 'Diagram — class',
        detail: "Mermaid's own class diagram, for when UML is what you want",
        keywords: 'class diagram uml mermaid classes methods association',
        code: fence(
          'mermaid',
          'classDiagram\n  class Note {\n    +String title\n    +save()\n  }\n  Note "1" --> "*" Tag'
        )
      },
      {
        label: 'Diagram — entity relationship',
        detail: 'Tables and the keys between them',
        keywords: 'er entity relationship database schema tables keys',
        code: fence(
          'mermaid',
          'erDiagram\n  NOTE ||--o{ TAG : carries\n  NOTE {\n    string title\n    date created\n  }'
        )
      },
      {
        label: 'Diagram — git history',
        detail: 'Commits, branches and a merge',
        keywords: 'git gitgraph branch merge commit history version control rebase',
        code: fence(
          'mermaid',
          'gitGraph\n  commit id: "init"\n  branch feature\n  commit id: "draft"\n  commit id: "tests"\n  checkout main\n  commit id: "hotfix"\n  merge feature'
        )
      },
      {
        label: 'Diagram — Gantt',
        detail: 'A plan, on dates',
        keywords: 'gantt timeline plan schedule project tasks dates',
        code: fence(
          'mermaid',
          'gantt\n  title A plan\n  dateFormat YYYY-MM-DD\n  section Build\n  Draft :a1, 2026-09-14, 5d\n  Review :after a1, 3d'
        )
      }
    ],
    words: [
      { word: 'flowchart', detail: 'Boxes and arrows', sample: 'TD', boost: 3 },
      { word: 'sequenceDiagram', detail: 'Messages between participants, top to bottom', boost: 3 },
      { word: 'stateDiagram-v2', detail: 'States and transitions', boost: 2 },
      { word: 'classDiagram', detail: 'Classes and their relations', boost: 2 },
      { word: 'erDiagram', detail: 'Entities and keys', boost: 2 },
      { word: 'gitGraph', detail: 'Commits, branches and merges', boost: 1 },
      { word: 'gantt', detail: 'A schedule, on dates', boost: 1 },
      { word: 'pie', detail: 'Proportions', sample: 'title Where the time went', boost: 1 },
      { word: 'mindmap', detail: 'A tree of ideas', boost: 1 },
      { word: 'journey', detail: 'A user journey, scored' },
      { word: 'timeline', detail: 'Events along a line' },
      { word: 'subgraph', detail: 'A box drawn round several nodes', sample: 'Name' },
      { word: 'participant', detail: 'In a sequence diagram, a column', sample: 'Server' },
      { word: 'end', detail: 'Closes a subgraph, loop or alt' }
    ]
  },

  // ---------------------------------------------------------------- threads
  {
    id: 'threads',
    fence: 'threads',
    label: 'Interleaving',
    blurb: 'One schedule out of the many the machine was allowed to pick.',
    docs: { topic: 'figures', section: 'threads — a schedule, and what it cost' },
    annotated: true,
    presets: [
      {
        label: 'Interleaving',
        detail: 'Two threads, one schedule, and the update that went missing',
        keywords: 'thread concurrency race interleaving schedule lost update data race atomic',
        headline: true,
        code: fence(
          'threads',
          `title: A lost update\nT1 read x | 0\nT2 read x | 0\nT1 x = x + 1\nT2 x = x + 1\nT1 write x | 1 #red\nT2 write x | 1 #red\nnote One increment is gone${CARET}`
        )
      },
      {
        label: 'Interleaving — a monitor',
        detail: 'The same two threads, with the critical section held',
        keywords: 'monitor lock mutex synchronized critical section mutual exclusion blocked',
        code: fence(
          'threads',
          'title: The same schedule, under a lock\nthreads: T1 T2\nT1 lock m\nT2 wait m\nT1 read x | 0\nT1 write x | 1\nT1 unlock m\nT2 lock m\nT2 read x | 1\nT2 write x | 2\nT2 unlock m\nnote Both increments survive'
        )
      },
      {
        label: 'Interleaving — deadlock',
        detail: 'Two locks, taken in opposite orders',
        keywords: 'deadlock lock ordering cycle hold and wait dining philosophers stuck',
        code: fence(
          'threads',
          `title: Taken in opposite orders\nT1 lock a\nT2 lock b\nT1 wait b\nT2 wait a\nnote Neither can go on, and neither will let go${CARET}`
        )
      }
    ],
    keys: [
      {
        key: 'threads',
        detail: 'The columns, in order',
        sample: 'T1 T2',
        boost: 3,
        info: 'Optional: a thread appears the first time it does something. Worth writing when the order of the columns matters more than the order of the first steps.'
      },
      TITLE,
      CAPTION
    ],
    words: [
      {
        word: '(a step)',
        detail: 'A thread, then what it did',
        sample: 'T1 read x | 0',
        boost: 3,
        info: 'One step a line, in the order they happen — that order is the whole content. After `|` goes what the thread saw, which is what makes a lost update visible.'
      },
      {
        word: '(taking a lock)',
        detail: '`lock`, and `unlock` to let it go',
        sample: 'T1 lock m',
        boost: 2,
        info: 'Draws a bar down the side of that column for as long as it is held. A lock never released is held to the bottom of the figure, which is usually the point.'
      },
      {
        word: '(blocked)',
        detail: 'In the schedule, but nothing happened',
        sample: 'T2 wait m',
        boost: 2
      },
      { word: 'note', detail: 'A remark in the right-hand margin, against the row above', sample: 'Both wrote 1', boost: 2 }
    ]
  },

  // ---------------------------------------------------------------- grammar
  {
    id: 'grammar',
    fence: 'grammar',
    label: 'Grammar',
    blurb: 'EBNF, drawn as the track it already is.',
    docs: { topic: 'figures', section: 'grammar — a syntax, as railroad' },
    presets: [
      {
        label: 'Grammar',
        detail: 'EBNF rules, drawn as railroad diagrams',
        keywords: 'grammar ebnf bnf railroad syntax diagram parse parser rule production nonterminal',
        headline: true,
        code: fence(
          'grammar',
          `expr ::= term { "+" term }\nterm ::= factor { "*" factor }\nfactor ::= NUMBER | "(" expr ")"${CARET}`
        )
      },
      {
        label: 'Grammar — optional and repeated',
        detail: 'A bypass over the top, and a line back underneath',
        keywords: 'optional repeat star plus question bypass loop ebnf postfix',
        code: fence(
          'grammar',
          'stmt ::= "if" expr "then" stmt [ "else" stmt ]\nargs ::= expr { "," expr }\nname ::= LETTER { LETTER | DIGIT }'
        )
      },
      {
        label: 'Grammar — a list of alternatives',
        detail: 'One rule, written down the page',
        keywords: 'alternatives choice fork json value union variant',
        code: fence(
          'grammar',
          `value ::= object\n | array\n | STRING\n | NUMBER\n | "true"\n | "false"\n | "null"${CARET}`
        )
      }
    ],
    keys: [TITLE, CAPTION],
    words: [
      {
        word: '(a rule)',
        detail: 'A name, `::=`, and what it may be',
        sample: 'expr ::= term "+" expr',
        boost: 3,
        info: '`::=`, `=`, `->` and `:` all define a rule. A line starting with `|` continues the rule above it, which is how a grammar with six alternatives is written by hand.'
      },
      {
        word: '(a literal)',
        detail: 'Quoted — what actually appears in the input',
        sample: '"+"',
        boost: 2,
        info: 'Quotes are the only thing that makes a terminal a terminal. A literal is drawn as a stadium and a rule name as a rectangle, so the shape says whether the reader has to go and look it up.'
      },
      { word: '(optional)', detail: 'Zero or one — a bypass over the top', sample: '[ "else" stmt ]', boost: 2 },
      { word: '(repeated)', detail: 'Zero or more — a line back underneath', sample: '{ "," expr }', boost: 2 },
      { word: '(alternatives)', detail: 'A fork, one branch a line', sample: 'a | b | c', boost: 1 },
      { word: '(nothing)', detail: 'The empty string, drawn as a straight line', sample: 'ε' }
    ]
  },

  // -------------------------------------------------------------------- svg
  {
    id: 'svg',
    fence: 'svg',
    label: 'Drawing',
    blurb: 'Inline SVG, for the pictures no diagram language will draw.',
    docs: { topic: 'writing', section: 'Diagrams and drawings' },
    presets: [
      {
        label: 'Drawing',
        detail: 'An inline SVG picture',
        keywords: 'svg drawing picture illustration vector sketch',
        headline: true,
        code: fence(
          'svg',
          `<svg viewBox="0 0 800 450">\n  <circle cx="400" cy="225" r="120" fill="none" stroke="currentColor" stroke-width="2" />\n  ${CARET}\n</svg>`
        )
      },
      {
        label: 'Drawing — labelled diagram',
        detail: 'A box, an arrow and some text, to build on',
        keywords: 'svg box arrow label annotate figure custom',
        code: fence(
          'svg',
          '<svg viewBox="0 0 800 300">\n  <rect x="60" y="80" width="200" height="120" rx="8" fill="none" stroke="currentColor" stroke-width="2" />\n  <text x="160" y="145" text-anchor="middle" fill="currentColor" font-size="18">Before</text>\n  <line x1="280" y1="140" x2="520" y2="140" stroke="currentColor" stroke-width="2" />\n  <text x="400" y="126" text-anchor="middle" fill="currentColor" font-size="14">maps to</text>\n</svg>'
        )
      }
    ],
    words: [
      {
        word: 'rect',
        detail: 'A rectangle',
        sample: 'x="0" y="0" width="100" height="60"',
        boost: 2,
        info: 'Use `currentColor` for strokes and fills and the drawing follows the theme, light or dark, instead of vanishing into one of them.'
      },
      { word: 'circle', detail: 'A circle', sample: 'cx="50" cy="50" r="20"', boost: 2 },
      { word: 'ellipse', detail: 'An ellipse', sample: 'cx="50" cy="50" rx="30" ry="20"' },
      { word: 'line', detail: 'A straight line', sample: 'x1="0" y1="0" x2="100" y2="0"', boost: 2 },
      { word: 'path', detail: 'Anything else', sample: 'd="M 0 0 L 100 50"', boost: 1 },
      { word: 'polyline', detail: 'A run of joined points', sample: 'points="0,0 20,40 60,10"' },
      { word: 'polygon', detail: 'The same, closed', sample: 'points="0,0 40,0 20,40"' },
      { word: 'text', detail: 'A label', sample: 'x="50" y="50" text-anchor="middle"', boost: 2 },
      { word: 'g', detail: 'A group, so a transform applies to several shapes' },
      { word: 'defs', detail: 'Definitions — markers, gradients — used below' },
      { word: 'marker', detail: 'An arrowhead, referenced by `marker-end`' }
    ]
  },

  // ------------------------------------------------------------------ query
  {
    id: 'stone',
    fence: 'stone',
    label: 'Query',
    blurb: 'A live list of notes or tasks, rendered where you wrote it.',
    docs: { topic: 'queries', section: 'The keys' },
    presets: [
      {
        label: 'Query',
        detail: 'A live list of notes or tasks',
        keywords: 'query database view dataview list filter',
        headline: true,
        code: fence('stone', `from: ${CARET}\nwhere: status is active\nsort: edited desc`)
      },
      {
        label: 'Query — the tasks in a folder',
        detail: 'Every checkbox in the notes under it',
        keywords: 'tasks todo checkbox open outstanding folder',
        code: fence('stone', 'source: tasks\nfrom: Projects\nlimit: 20')
      },
      {
        label: 'Query — a board',
        detail: 'Notes in a folder, in columns by status',
        keywords: 'board kanban columns group status projects',
        code: fence('stone', `from: Projects\nwhere: status is not done\nas: board\ngroup: status${CARET}`)
      },
      {
        label: 'Query — a table',
        detail: 'Chosen properties as columns',
        keywords: 'table columns properties grid fields',
        code: fence('stone', 'from: Reading\nas: table\ncolumns: title, author, rating\nsort: rating desc')
      },
      {
        label: 'Query — recently edited',
        detail: 'The last ten notes you touched',
        keywords: 'recent edited latest changed activity',
        code: fence('stone', 'sort: edited desc\nlimit: 10')
      },
      {
        label: 'Query — a saved view',
        detail: 'Name one you already built',
        keywords: 'view saved reference reuse',
        code: fence('stone', `view: ${CARET}`)
      }
    ],
    keys: [
      { key: 'from', detail: 'A folder to look in', sample: 'Projects', boost: 3 },
      {
        key: 'where',
        detail: 'A filter',
        sample: 'status is active',
        boost: 3,
        info: 'Operators: `is`, `is not`, `contains`, `not contains`, `before`, `after`, `is empty`, `is not empty`. One `where:` a line, and they all have to hold.'
      },
      { key: 'sort', detail: 'A property and a direction', sample: 'due asc', boost: 2 },
      {
        key: 'source',
        detail: 'Notes, or the tasks inside them',
        sample: 'tasks',
        boost: 2,
        values: [
          { label: 'notes', detail: 'One row a note — the default' },
          { label: 'tasks', detail: 'One row a checkbox, from every note' }
        ]
      },
      {
        key: 'as',
        detail: 'What shape to draw it in',
        sample: 'table',
        boost: 2,
        values: [
          { label: 'list', detail: 'A plain list — the default' },
          { label: 'table', detail: 'Properties as columns' },
          { label: 'board', detail: 'Columns, grouped by a property' },
          { label: 'gallery', detail: 'Cards' },
          { label: 'timeline', detail: 'Along a date' }
        ]
      },
      { key: 'group', detail: 'A property to group rows under', sample: 'status' },
      { key: 'columns', detail: 'Which properties to show', sample: 'title, due, status' },
      { key: 'limit', detail: 'How many rows at most', sample: '10' },
      {
        key: 'view',
        detail: 'Name a view you already saved',
        sample: 'Active projects',
        info: 'A block that names a saved view and describes one too is ambiguous, and the saved view wins. Write one or the other.'
      }
    ]
  },

  // --------------------------------------------------------------- contents
  {
    id: 'toc',
    fence: 'toc',
    label: 'Contents',
    blurb: "This note's headings, listed and clickable.",
    docs: { topic: 'writing', section: 'Contents' },
    presets: [
      {
        label: 'Contents',
        detail: "This note's headings, listed and clickable",
        keywords: 'toc table of contents outline headings index navigation',
        headline: true,
        code: fence('toc', '')
      },
      {
        label: 'Contents — top level only',
        detail: 'Just the `##` headings, for a long note',
        keywords: 'toc levels depth shallow top level',
        code: fence('toc', 'levels: 2')
      }
    ],
    keys: [
      {
        key: 'levels',
        detail: 'Which heading depths to list — `2-6` by default',
        sample: '2-3',
        boost: 3,
        info: 'A single number takes that level alone; `2-3` takes the range. The list updates as the note does, because it is read from the headings rather than written down.'
      }
    ]
  },

  // ------------------------------------------------------------------ maths
  {
    id: 'math',
    fence: null,
    label: 'Maths',
    blurb: 'KaTeX, inline or on its own line.',
    docs: { topic: 'writing', section: 'Maths' },
    presets: [
      {
        label: 'Maths block',
        detail: 'Display equation',
        keywords: 'math latex katex equation formula display',
        headline: true,
        code: `$$\n${CARET}\n$$`
      },
      {
        label: 'Maths — aligned',
        detail: 'Several lines, lined up on the `=`',
        keywords: 'align aligned equations steps derivation multiline',
        code: `$$\n\\begin{aligned}\n  (a+b)^2 &= a^2 + 2ab + b^2 \\\\\n  &= ${CARET}\n\\end{aligned}\n$$`
      },
      {
        label: 'Maths — matrix',
        detail: 'A bracketed matrix',
        keywords: 'matrix bmatrix vector linear algebra grid',
        code: `$$\n\\begin{bmatrix}\n  a & b \\\\\n  c & d\n\\end{bmatrix}\n$$`
      },
      {
        label: 'Maths — cases',
        detail: 'A piecewise definition',
        keywords: 'cases piecewise definition branch otherwise',
        code: `$$\nf(n) = \\begin{cases}\n  1 & n \\le 1 \\\\\n  n f(n-1) & \\text{otherwise}\n\\end{cases}\n$$`
      }
    ]
  },

  // ------------------------------------------------------------------ table
  {
    id: 'table',
    fence: null,
    label: 'Table',
    blurb: 'A GFM table, edited cell by cell.',
    docs: { topic: 'writing', section: 'Tables' },
    presets: [
      {
        label: 'Table',
        detail: 'A three-column table',
        keywords: 'table grid rows columns',
        headline: true,
        code: `| ${CARET} |     |     |\n| --- | --- | --- |\n|     |     |     |`
      },
      {
        label: 'Table — with headings',
        detail: 'Named columns, and one row to start',
        keywords: 'table headings header named columns',
        code: `| Name | What it does | Notes |\n| --- | --- | --- |\n| ${CARET} |  |  |`
      },
      {
        label: 'Table — aligned columns',
        detail: 'Left, centre and right, set in the rule',
        keywords: 'table align alignment centre right numbers',
        code: '| Item | Count | Cost |\n| :--- | :---: | ---: |\n|  |  |  |'
      }
    ]
  }
]

const BY_FENCE = new Map<string, Datatype>()
for (const type of DATATYPES) if (type.fence) BY_FENCE.set(type.fence, type)
// The aliases the renderer accepts for the same block, so a `query` fence gets
// the same suggestions a `stone` one does.
BY_FENCE.set('query', BY_FENCE.get('stone') as Datatype)
BY_FENCE.set('contents', BY_FENCE.get('toc') as Datatype)

/** The datatype a fence word names, or null if it names none. */
export function datatypeFor(fence: string): Datatype | null {
  return BY_FENCE.get(fence.toLowerCase()) ?? null
}

export function datatypeById(id: string): Datatype | null {
  return DATATYPES.find((type) => type.id === id) ?? null
}

/** A directive by name, for offering its values after the colon. */
export function keyNamed(type: Datatype, name: string): DataKey | null {
  const wanted = name.toLowerCase()
  return type.keys?.find((key) => key.key === wanted) ?? null
}

/** Every preset, in menu order. */
export function allPresets(): Array<{ type: Datatype; preset: DataPreset }> {
  return DATATYPES.flatMap((type) => type.presets.map((preset) => ({ type, preset })))
}
