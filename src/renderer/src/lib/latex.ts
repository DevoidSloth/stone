/**
 * The LaTeX commands the editor suggests, and how to find one.
 *
 * KaTeX knows several hundred control sequences and gives no list of them: its
 * tables are internal, and reading them would tie the menu to a private shape
 * that changes between releases. What is here instead is a curated table — the
 * commands someone writing maths in a note actually reaches for, each with the
 * character it draws and the words they would search for it by.
 *
 * The character matters more than it looks. Nobody remembers whether "much
 * less than" is `\ll` or `\lll`, or which of `\subset` and `\subseteq` has the
 * bar; they remember the shape. So the glyph leads the label, the way the emoji
 * menu puts the emoji before its name, and picking by eye works even when the
 * name means nothing.
 *
 * `args` is how many `{}` groups the command takes, which is what turns
 * `\frac` into `\frac{}{}` with the caret in the first one. `\left(`-style
 * pairs and the environments are the same idea one level up.
 */

/**
 * Where the caret goes in a snippet.
 *
 * Not `|` — which is what every other snippet in the editor uses — because in
 * TeX the vertical bar is a character in its own right, and `\left| ‸ \right|`
 * would otherwise have its caret placed inside the word "left".
 */
export const CARET = '‸'

export interface LatexCommand {
  /** Without the backslash. */
  name: string
  /** What it draws, where it draws a single character. */
  symbol?: string
  /** The group it belongs to, shown on the right of the row. */
  group: string
  /** How many `{}` groups follow, for the snippet. */
  args?: number
  /** Extra words to match on, for the name nobody remembers. */
  keywords?: string
  /**
   * The snippet, where it is not simply the command and its groups — `\left(`
   * has to bring its `\right)` with it or the equation will not parse.
   * `CARET` marks where the caret should land.
   */
  snippet?: string
  /** TeX that shows the command doing its job, for the preview panel. */
  sample?: string
}

/*
 * Grouped the way a person looking for one would group them, because the group
 * is what the menu shows when the name is not enough to tell two rows apart.
 */
export const LATEX_COMMANDS: LatexCommand[] = [
  // ------------------------------------------------------------ Greek
  { name: 'alpha', symbol: 'α', group: 'Greek' },
  { name: 'beta', symbol: 'β', group: 'Greek' },
  { name: 'gamma', symbol: 'γ', group: 'Greek' },
  { name: 'delta', symbol: 'δ', group: 'Greek' },
  { name: 'epsilon', symbol: 'ϵ', group: 'Greek' },
  { name: 'varepsilon', symbol: 'ε', group: 'Greek' },
  { name: 'zeta', symbol: 'ζ', group: 'Greek' },
  { name: 'eta', symbol: 'η', group: 'Greek' },
  { name: 'theta', symbol: 'θ', group: 'Greek' },
  { name: 'vartheta', symbol: 'ϑ', group: 'Greek' },
  { name: 'iota', symbol: 'ι', group: 'Greek' },
  { name: 'kappa', symbol: 'κ', group: 'Greek' },
  { name: 'lambda', symbol: 'λ', group: 'Greek' },
  { name: 'mu', symbol: 'μ', group: 'Greek' },
  { name: 'nu', symbol: 'ν', group: 'Greek' },
  { name: 'xi', symbol: 'ξ', group: 'Greek' },
  { name: 'pi', symbol: 'π', group: 'Greek' },
  { name: 'rho', symbol: 'ρ', group: 'Greek' },
  { name: 'sigma', symbol: 'σ', group: 'Greek' },
  { name: 'tau', symbol: 'τ', group: 'Greek' },
  { name: 'upsilon', symbol: 'υ', group: 'Greek' },
  { name: 'phi', symbol: 'ϕ', group: 'Greek' },
  { name: 'varphi', symbol: 'φ', group: 'Greek' },
  { name: 'chi', symbol: 'χ', group: 'Greek' },
  { name: 'psi', symbol: 'ψ', group: 'Greek' },
  { name: 'omega', symbol: 'ω', group: 'Greek' },
  { name: 'Gamma', symbol: 'Γ', group: 'Greek' },
  { name: 'Delta', symbol: 'Δ', group: 'Greek', keywords: 'change difference' },
  { name: 'Theta', symbol: 'Θ', group: 'Greek', keywords: 'complexity order' },
  { name: 'Lambda', symbol: 'Λ', group: 'Greek' },
  { name: 'Xi', symbol: 'Ξ', group: 'Greek' },
  { name: 'Pi', symbol: 'Π', group: 'Greek' },
  { name: 'Sigma', symbol: 'Σ', group: 'Greek' },
  { name: 'Upsilon', symbol: 'Υ', group: 'Greek' },
  { name: 'Phi', symbol: 'Φ', group: 'Greek' },
  { name: 'Psi', symbol: 'Ψ', group: 'Greek' },
  { name: 'Omega', symbol: 'Ω', group: 'Greek', keywords: 'ohm complexity' },

  // ------------------------------------------------------- structure
  {
    name: 'frac',
    symbol: '½',
    group: 'Layout',
    args: 2,
    keywords: 'fraction divide over quotient ratio',
    sample: '\\frac{a}{b}'
  },
  { name: 'dfrac', group: 'Layout', args: 2, keywords: 'fraction display big', sample: '\\dfrac{a}{b}' },
  { name: 'tfrac', group: 'Layout', args: 2, keywords: 'fraction small inline', sample: '\\tfrac{a}{b}' },
  {
    name: 'binom',
    group: 'Layout',
    args: 2,
    keywords: 'binomial choose combination n k',
    sample: '\\binom{n}{k}'
  },
  { name: 'sqrt', symbol: '√', group: 'Layout', args: 1, keywords: 'root square', sample: '\\sqrt{x}' },
  {
    name: 'sqrt[n]',
    symbol: '∛',
    group: 'Layout',
    keywords: 'root cube nth',
    snippet: '\\sqrt[3]{‸}',
    sample: '\\sqrt[3]{x}'
  },
  { name: 'overline', symbol: 'x̄', group: 'Layout', args: 1, keywords: 'bar mean conjugate', sample: '\\overline{x}' },
  { name: 'underline', group: 'Layout', args: 1, sample: '\\underline{x}' },
  {
    name: 'overbrace',
    group: 'Layout',
    keywords: 'brace annotate label group',
    snippet: '\\overbrace{‸}^{}',
    sample: '\\overbrace{a+b}^{n}'
  },
  {
    name: 'underbrace',
    group: 'Layout',
    keywords: 'brace annotate label group',
    snippet: '\\underbrace{‸}_{}',
    sample: '\\underbrace{a+b}_{n}'
  },
  { name: 'hat', symbol: 'x̂', group: 'Accent', args: 1, keywords: 'estimate circumflex', sample: '\\hat{x}' },
  { name: 'widehat', group: 'Accent', args: 1, keywords: 'hat wide', sample: '\\widehat{xy}' },
  { name: 'bar', symbol: 'x̄', group: 'Accent', args: 1, keywords: 'mean average', sample: '\\bar{x}' },
  { name: 'vec', symbol: 'x⃗', group: 'Accent', args: 1, keywords: 'vector arrow', sample: '\\vec{v}' },
  { name: 'dot', symbol: 'ẋ', group: 'Accent', args: 1, keywords: 'derivative time', sample: '\\dot{x}' },
  { name: 'ddot', symbol: 'ẍ', group: 'Accent', args: 1, keywords: 'second derivative', sample: '\\ddot{x}' },
  { name: 'tilde', symbol: 'x̃', group: 'Accent', args: 1, sample: '\\tilde{x}' },
  { name: 'widetilde', group: 'Accent', args: 1, sample: '\\widetilde{xy}' },

  // ------------------------------------------------------- big operators
  {
    name: 'sum',
    symbol: '∑',
    group: 'Operator',
    keywords: 'sigma add total series',
    snippet: '\\sum_{‸}^{}',
    sample: '\\sum_{n=1}^{\\infty} a_n'
  },
  {
    name: 'prod',
    symbol: '∏',
    group: 'Operator',
    keywords: 'product multiply',
    snippet: '\\prod_{‸}^{}',
    sample: '\\prod_{i=1}^{n} x_i'
  },
  {
    name: 'int',
    symbol: '∫',
    group: 'Operator',
    keywords: 'integral',
    snippet: '\\int_{‸}^{}',
    sample: '\\int_a^b f(x)\\,dx'
  },
  { name: 'iint', symbol: '∬', group: 'Operator', keywords: 'double integral' },
  { name: 'iiint', symbol: '∭', group: 'Operator', keywords: 'triple integral' },
  { name: 'oint', symbol: '∮', group: 'Operator', keywords: 'contour integral loop' },
  { name: 'bigcup', symbol: '⋃', group: 'Operator', keywords: 'union big' },
  { name: 'bigcap', symbol: '⋂', group: 'Operator', keywords: 'intersection big' },
  { name: 'bigoplus', symbol: '⨁', group: 'Operator', keywords: 'direct sum' },
  { name: 'bigotimes', symbol: '⨂', group: 'Operator', keywords: 'tensor product' },
  {
    name: 'lim',
    group: 'Operator',
    keywords: 'limit tends approaches',
    snippet: '\\lim_{‸ \\to }',
    sample: '\\lim_{x \\to 0} f(x)'
  },
  { name: 'limsup', group: 'Operator', keywords: 'limit superior' },
  { name: 'liminf', group: 'Operator', keywords: 'limit inferior' },
  { name: 'max', group: 'Operator', keywords: 'maximum largest' },
  { name: 'min', group: 'Operator', keywords: 'minimum smallest' },
  { name: 'sup', group: 'Operator', keywords: 'supremum least upper bound' },
  { name: 'inf', group: 'Operator', keywords: 'infimum greatest lower bound' },
  {
    name: 'argmax',
    group: 'Operator',
    keywords: 'argument maximum',
    snippet: '\\operatorname*{arg\\,max}_{‸}',
    sample: '\\operatorname*{arg\\,max}_{x} f(x)'
  },
  {
    name: 'argmin',
    group: 'Operator',
    keywords: 'argument minimum',
    snippet: '\\operatorname*{arg\\,min}_{‸}',
    sample: '\\operatorname*{arg\\,min}_{x} f(x)'
  },
  { name: 'operatorname', group: 'Operator', args: 1, keywords: 'custom function name upright' },

  // ------------------------------------------------------- named functions
  { name: 'sin', group: 'Function', keywords: 'sine trig' },
  { name: 'cos', group: 'Function', keywords: 'cosine trig' },
  { name: 'tan', group: 'Function', keywords: 'tangent trig' },
  { name: 'arcsin', group: 'Function', keywords: 'inverse sine' },
  { name: 'arccos', group: 'Function', keywords: 'inverse cosine' },
  { name: 'arctan', group: 'Function', keywords: 'inverse tangent' },
  { name: 'sinh', group: 'Function', keywords: 'hyperbolic' },
  { name: 'cosh', group: 'Function', keywords: 'hyperbolic' },
  { name: 'tanh', group: 'Function', keywords: 'hyperbolic' },
  { name: 'log', group: 'Function', keywords: 'logarithm' },
  { name: 'ln', group: 'Function', keywords: 'natural logarithm' },
  { name: 'exp', group: 'Function', keywords: 'exponential' },
  { name: 'det', group: 'Function', keywords: 'determinant matrix' },
  { name: 'dim', group: 'Function', keywords: 'dimension' },
  { name: 'gcd', group: 'Function', keywords: 'greatest common divisor' },
  { name: 'deg', group: 'Function', keywords: 'degree' },
  { name: 'ker', group: 'Function', keywords: 'kernel null space' },
  { name: 'bmod', group: 'Function', keywords: 'modulo remainder' },
  { name: 'pmod', group: 'Function', args: 1, keywords: 'modulo congruence', sample: 'a \\equiv b \\pmod{n}' },

  // ------------------------------------------------------- relations
  { name: 'leq', symbol: '≤', group: 'Relation', keywords: 'less than or equal le' },
  { name: 'geq', symbol: '≥', group: 'Relation', keywords: 'greater than or equal ge' },
  { name: 'neq', symbol: '≠', group: 'Relation', keywords: 'not equal ne different' },
  { name: 'approx', symbol: '≈', group: 'Relation', keywords: 'approximately about roughly' },
  { name: 'sim', symbol: '∼', group: 'Relation', keywords: 'similar distributed as tilde' },
  { name: 'simeq', symbol: '≃', group: 'Relation', keywords: 'asymptotically equal' },
  { name: 'cong', symbol: '≅', group: 'Relation', keywords: 'congruent isomorphic' },
  { name: 'equiv', symbol: '≡', group: 'Relation', keywords: 'equivalent identical congruent' },
  { name: 'propto', symbol: '∝', group: 'Relation', keywords: 'proportional to varies' },
  { name: 'll', symbol: '≪', group: 'Relation', keywords: 'much less than' },
  { name: 'gg', symbol: '≫', group: 'Relation', keywords: 'much greater than' },
  { name: 'prec', symbol: '≺', group: 'Relation', keywords: 'precedes before order' },
  { name: 'succ', symbol: '≻', group: 'Relation', keywords: 'succeeds after order' },
  { name: 'preceq', symbol: '⪯', group: 'Relation', keywords: 'precedes or equals' },
  { name: 'succeq', symbol: '⪰', group: 'Relation', keywords: 'succeeds or equals' },
  { name: 'perp', symbol: '⊥', group: 'Relation', keywords: 'perpendicular orthogonal bottom' },
  { name: 'parallel', symbol: '∥', group: 'Relation', keywords: 'parallel' },
  { name: 'mid', symbol: '∣', group: 'Relation', keywords: 'divides given such that bar' },
  { name: 'nmid', symbol: '∤', group: 'Relation', keywords: 'does not divide' },
  { name: 'doteq', symbol: '≐', group: 'Relation', keywords: 'defined as approaches' },

  // ------------------------------------------------------- set theory
  { name: 'in', symbol: '∈', group: 'Set', keywords: 'element of member belongs' },
  { name: 'notin', symbol: '∉', group: 'Set', keywords: 'not an element of' },
  { name: 'ni', symbol: '∋', group: 'Set', keywords: 'contains as member' },
  { name: 'subset', symbol: '⊂', group: 'Set', keywords: 'proper subset' },
  { name: 'subseteq', symbol: '⊆', group: 'Set', keywords: 'subset or equal' },
  { name: 'supset', symbol: '⊃', group: 'Set', keywords: 'proper superset' },
  { name: 'supseteq', symbol: '⊇', group: 'Set', keywords: 'superset or equal' },
  { name: 'nsubseteq', symbol: '⊈', group: 'Set', keywords: 'not a subset' },
  { name: 'cup', symbol: '∪', group: 'Set', keywords: 'union or join' },
  { name: 'cap', symbol: '∩', group: 'Set', keywords: 'intersection and meet' },
  { name: 'setminus', symbol: '∖', group: 'Set', keywords: 'difference without minus except' },
  { name: 'emptyset', symbol: '∅', group: 'Set', keywords: 'empty null nothing' },
  { name: 'varnothing', symbol: '∅', group: 'Set', keywords: 'empty set slashed' },
  { name: 'mathbb{R}', symbol: 'ℝ', group: 'Set', keywords: 'reals real numbers blackboard' },
  { name: 'mathbb{N}', symbol: 'ℕ', group: 'Set', keywords: 'naturals counting numbers' },
  { name: 'mathbb{Z}', symbol: 'ℤ', group: 'Set', keywords: 'integers whole numbers' },
  { name: 'mathbb{Q}', symbol: 'ℚ', group: 'Set', keywords: 'rationals fractions' },
  { name: 'mathbb{C}', symbol: 'ℂ', group: 'Set', keywords: 'complex numbers' },
  { name: 'aleph', symbol: 'ℵ', group: 'Set', keywords: 'cardinality infinity aleph null' },

  // ------------------------------------------------------- logic
  { name: 'forall', symbol: '∀', group: 'Logic', keywords: 'for all every universal' },
  { name: 'exists', symbol: '∃', group: 'Logic', keywords: 'there exists some' },
  { name: 'nexists', symbol: '∄', group: 'Logic', keywords: 'there is no' },
  { name: 'neg', symbol: '¬', group: 'Logic', keywords: 'not negation lnot' },
  { name: 'land', symbol: '∧', group: 'Logic', keywords: 'and conjunction wedge' },
  { name: 'lor', symbol: '∨', group: 'Logic', keywords: 'or disjunction vee' },
  { name: 'implies', symbol: '⟹', group: 'Logic', keywords: 'therefore then if' },
  { name: 'iff', symbol: '⟺', group: 'Logic', keywords: 'if and only if equivalent' },
  { name: 'therefore', symbol: '∴', group: 'Logic', keywords: 'so hence conclusion' },
  { name: 'because', symbol: '∵', group: 'Logic', keywords: 'since as' },
  { name: 'top', symbol: '⊤', group: 'Logic', keywords: 'true tautology' },
  { name: 'bot', symbol: '⊥', group: 'Logic', keywords: 'false contradiction bottom' },
  { name: 'vdash', symbol: '⊢', group: 'Logic', keywords: 'proves entails turnstile' },
  { name: 'models', symbol: '⊨', group: 'Logic', keywords: 'satisfies entails' },

  // ------------------------------------------------------- arrows
  { name: 'to', symbol: '→', group: 'Arrow', keywords: 'right arrow maps tends rightarrow' },
  { name: 'gets', symbol: '←', group: 'Arrow', keywords: 'left arrow assign leftarrow' },
  { name: 'leftrightarrow', symbol: '↔', group: 'Arrow', keywords: 'both ways' },
  { name: 'Rightarrow', symbol: '⇒', group: 'Arrow', keywords: 'implies double' },
  { name: 'Leftarrow', symbol: '⇐', group: 'Arrow', keywords: 'implied by double' },
  { name: 'Leftrightarrow', symbol: '⇔', group: 'Arrow', keywords: 'iff double' },
  { name: 'mapsto', symbol: '↦', group: 'Arrow', keywords: 'maps to function lambda' },
  { name: 'hookrightarrow', symbol: '↪', group: 'Arrow', keywords: 'injection embeds' },
  { name: 'twoheadrightarrow', symbol: '↠', group: 'Arrow', keywords: 'surjection onto' },
  { name: 'uparrow', symbol: '↑', group: 'Arrow', keywords: 'up' },
  { name: 'downarrow', symbol: '↓', group: 'Arrow', keywords: 'down' },
  { name: 'longrightarrow', symbol: '⟶', group: 'Arrow', keywords: 'long right' },
  { name: 'xrightarrow', group: 'Arrow', args: 1, keywords: 'labelled arrow over', sample: 'a \\xrightarrow{f} b' },
  { name: 'rightleftharpoons', symbol: '⇌', group: 'Arrow', keywords: 'equilibrium reaction chemistry' },

  // ------------------------------------------------------- binary operators
  { name: 'times', symbol: '×', group: 'Operator', keywords: 'multiply cross product' },
  { name: 'div', symbol: '÷', group: 'Operator', keywords: 'divide obelus' },
  { name: 'pm', symbol: '±', group: 'Operator', keywords: 'plus or minus tolerance' },
  { name: 'mp', symbol: '∓', group: 'Operator', keywords: 'minus or plus' },
  { name: 'cdot', symbol: '⋅', group: 'Operator', keywords: 'dot product multiply' },
  { name: 'ast', symbol: '∗', group: 'Operator', keywords: 'star convolution asterisk' },
  { name: 'circ', symbol: '∘', group: 'Operator', keywords: 'compose ring degree' },
  { name: 'bullet', symbol: '∙', group: 'Operator', keywords: 'dot' },
  { name: 'oplus', symbol: '⊕', group: 'Operator', keywords: 'xor direct sum' },
  { name: 'ominus', symbol: '⊖', group: 'Operator' },
  { name: 'otimes', symbol: '⊗', group: 'Operator', keywords: 'tensor kronecker' },
  { name: 'wedge', symbol: '∧', group: 'Operator', keywords: 'exterior and' },
  { name: 'star', symbol: '⋆', group: 'Operator' },
  { name: 'oslash', symbol: '⊘', group: 'Operator' },

  // ------------------------------------------------------- symbols
  { name: 'infty', symbol: '∞', group: 'Symbol', keywords: 'infinity unbounded' },
  { name: 'partial', symbol: '∂', group: 'Symbol', keywords: 'partial derivative del' },
  { name: 'nabla', symbol: '∇', group: 'Symbol', keywords: 'gradient div curl del' },
  { name: 'hbar', symbol: 'ℏ', group: 'Symbol', keywords: 'planck reduced' },
  { name: 'ell', symbol: 'ℓ', group: 'Symbol', keywords: 'script l length norm' },
  { name: 'Re', symbol: 'ℜ', group: 'Symbol', keywords: 'real part' },
  { name: 'Im', symbol: 'ℑ', group: 'Symbol', keywords: 'imaginary part' },
  { name: 'angle', symbol: '∠', group: 'Symbol', keywords: 'geometry' },
  { name: 'triangle', symbol: '△', group: 'Symbol', keywords: 'geometry delta' },
  { name: 'square', symbol: '□', group: 'Symbol', keywords: 'box qed empty' },
  { name: 'blacksquare', symbol: '■', group: 'Symbol', keywords: 'qed end of proof tombstone' },
  { name: 'checkmark', symbol: '✓', group: 'Symbol', keywords: 'tick yes done' },
  { name: 'dagger', symbol: '†', group: 'Symbol', keywords: 'adjoint conjugate transpose' },
  { name: 'prime', symbol: '′', group: 'Symbol', keywords: 'derivative dash apostrophe' },
  { name: 'degree', symbol: '°', group: 'Symbol', keywords: 'degrees angle temperature circ' },
  { name: 'cdots', symbol: '⋯', group: 'Symbol', keywords: 'ellipsis centre dots' },
  { name: 'ldots', symbol: '…', group: 'Symbol', keywords: 'ellipsis low dots' },
  { name: 'vdots', symbol: '⋮', group: 'Symbol', keywords: 'vertical dots' },
  { name: 'ddots', symbol: '⋱', group: 'Symbol', keywords: 'diagonal dots' },

  // ------------------------------------------------------- delimiters
  {
    name: 'left(',
    symbol: '(⋯)',
    group: 'Delimiter',
    keywords: 'parentheses brackets auto size grow',
    snippet: '\\left( ‸ \\right)',
    sample: '\\left( \\frac{a}{b} \\right)'
  },
  {
    name: 'left[',
    symbol: '[⋯]',
    group: 'Delimiter',
    keywords: 'square brackets auto size',
    snippet: '\\left[ ‸ \\right]',
    sample: '\\left[ \\frac{a}{b} \\right]'
  },
  {
    name: 'left\\{',
    symbol: '{⋯}',
    group: 'Delimiter',
    keywords: 'braces curly set auto size',
    snippet: '\\left\\{ ‸ \\right\\}',
    sample: '\\left\\{ \\frac{a}{b} \\right\\}'
  },
  {
    name: 'left|',
    symbol: '|⋯|',
    group: 'Delimiter',
    keywords: 'absolute value modulus magnitude',
    snippet: '\\left| ‸ \\right|',
    sample: '\\left| \\frac{a}{b} \\right|'
  },
  {
    name: 'left\\|',
    symbol: '‖⋯‖',
    group: 'Delimiter',
    keywords: 'norm length magnitude double bar',
    snippet: '\\left\\| ‸ \\right\\|',
    sample: '\\left\\| x \\right\\|'
  },
  {
    name: 'langle',
    symbol: '⟨⋯⟩',
    group: 'Delimiter',
    keywords: 'angle brackets inner product bra ket',
    snippet: '\\langle ‸ \\rangle',
    sample: '\\langle u, v \\rangle'
  },
  {
    name: 'lfloor',
    symbol: '⌊⋯⌋',
    group: 'Delimiter',
    keywords: 'floor round down',
    snippet: '\\lfloor ‸ \\rfloor',
    sample: '\\lfloor x \\rfloor'
  },
  {
    name: 'lceil',
    symbol: '⌈⋯⌉',
    group: 'Delimiter',
    keywords: 'ceiling round up',
    snippet: '\\lceil ‸ \\rceil',
    sample: '\\lceil x \\rceil'
  },

  // ------------------------------------------------------- typefaces
  { name: 'mathbb', group: 'Font', args: 1, keywords: 'blackboard bold double struck set', sample: '\\mathbb{R}' },
  { name: 'mathcal', group: 'Font', args: 1, keywords: 'calligraphic script fancy', sample: '\\mathcal{L}' },
  { name: 'mathbf', group: 'Font', args: 1, keywords: 'bold vector matrix', sample: '\\mathbf{v}' },
  { name: 'mathrm', group: 'Font', args: 1, keywords: 'roman upright unit', sample: '\\mathrm{d}x' },
  { name: 'mathit', group: 'Font', args: 1, keywords: 'italic' },
  { name: 'mathsf', group: 'Font', args: 1, keywords: 'sans serif' },
  { name: 'mathtt', group: 'Font', args: 1, keywords: 'monospace typewriter code' },
  { name: 'mathfrak', group: 'Font', args: 1, keywords: 'fraktur gothic algebra', sample: '\\mathfrak{g}' },
  { name: 'text', group: 'Font', args: 1, keywords: 'words prose upright english', sample: 'x \\text{ if } y' },
  { name: 'boldsymbol', group: 'Font', args: 1, keywords: 'bold greek vector' },

  // ------------------------------------------------------- spacing
  { name: 'quad', group: 'Spacing', keywords: 'space wide gap' },
  { name: 'qquad', group: 'Spacing', keywords: 'space wider gap' },
  { name: ',', group: 'Spacing', keywords: 'thin space differential dx' },
  { name: ';', group: 'Spacing', keywords: 'medium space' },
  { name: '!', group: 'Spacing', keywords: 'negative space tighten' },
  { name: 'hspace', group: 'Spacing', args: 1, keywords: 'horizontal space custom', sample: 'a \\hspace{2em} b' },
  { name: 'phantom', group: 'Spacing', args: 1, keywords: 'invisible align placeholder' },
  { name: 'tag', group: 'Layout', args: 1, keywords: 'equation number label', sample: 'x = 1 \\tag{1}' },
  { name: 'substack', group: 'Layout', args: 1, keywords: 'stacked subscript two lines' },
  { name: 'stackrel', group: 'Layout', args: 2, keywords: 'over above relation', sample: 'a \\stackrel{f}{=} b' },
  { name: 'boxed', group: 'Layout', args: 1, keywords: 'box frame answer highlight', sample: '\\boxed{E = mc^2}' },
  { name: 'color', group: 'Layout', args: 2, keywords: 'colour highlight red blue', sample: '\\color{red}{x}' }
]

/**
 * The `\begin{…}` environments, which are a menu of their own.
 *
 * Each carries the whole skeleton rather than just the name: an environment
 * opened and not closed is a parse error, and a matrix with no `&` in it gives
 * no hint that `&` is what separates the columns.
 */
export interface LatexEnvironment {
  name: string
  detail: string
  keywords: string
  /**
   * What `\begin{name}` takes after the name, for the one environment that
   * takes anything: `array` is a parse error without a column spec.
   */
  spec?: string
  /** The body between `\begin` and `\end`. `CARET` marks where it lands. */
  body: string
}

export const LATEX_ENVIRONMENTS: LatexEnvironment[] = [
  {
    name: 'aligned',
    detail: 'Equations lined up on their `&`',
    keywords: 'align steps working derivation multiline',
    body: '‸ &= \\\\\n  &='
  },
  { name: 'cases', detail: 'A piecewise definition', keywords: 'piecewise if otherwise branch', body: '‸ & \\text{if } \\\\\n  & \\text{otherwise}' },
  { name: 'matrix', detail: 'A matrix with no brackets', keywords: 'grid array', body: '‸ & \\\\\n  &' },
  { name: 'pmatrix', detail: 'A matrix in round brackets', keywords: 'matrix vector parentheses', body: '‸ & \\\\\n  &' },
  { name: 'bmatrix', detail: 'A matrix in square brackets', keywords: 'matrix vector square', body: '‸ & \\\\\n  &' },
  { name: 'vmatrix', detail: 'A determinant', keywords: 'matrix determinant bars', body: '‸ & \\\\\n  &' },
  { name: 'array', detail: 'A grid with column alignment', keywords: 'table grid columns', spec: '{cc}', body: '‸ & \\\\\n  &' },
  { name: 'gathered', detail: 'Centred lines, not aligned', keywords: 'multiline stack centre', body: '‸ \\\\\n  ' }
]

/** An environment, opened, closed, and with a body that shows what `&` is for. */
export function environmentSnippet(env: LatexEnvironment): string {
  return `\\begin{${env.name}}${env.spec ?? ''}\n  ${env.body}\n\\end{${env.name}}`
}

/** How a command is written out, with `CARET` where the caret should land. */
export function latexSnippet(command: LatexCommand): string {
  if (command.snippet) return command.snippet
  const args = command.args ?? 0
  if (args === 0) return `\\${command.name}`
  return `\\${command.name}{${CARET}}${'{}'.repeat(args - 1)}`
}

/** What the preview panel renders — the example, or the command by itself. */
export function latexSample(command: LatexCommand): string {
  if (command.sample) return command.sample
  const args = command.args ?? 0
  if (args === 0) return `\\${command.name}`
  return `\\${command.name}${'{x}'.repeat(args)}`
}

/**
 * Commands matching what has been typed, best first.
 *
 * A prefix of the name beats a match in the middle of it, which beats a match
 * on one of the search words. That ordering is the whole reason for scoring at
 * all: someone typing `\su` means `\sum`, and `\sum` is not the alphabetically
 * first command containing those two letters.
 */
export function findLatex(query: string): LatexCommand[] {
  const q = query.toLowerCase()
  if (!q) return LATEX_COMMANDS

  const scored: Array<{ command: LatexCommand; rank: number }> = []
  for (const command of LATEX_COMMANDS) {
    const name = command.name.toLowerCase()
    const rank = name.startsWith(q)
      ? 0
      : name.includes(q)
        ? 1
        : (command.keywords ?? '').includes(q)
          ? 2
          : -1
    if (rank >= 0) scored.push({ command, rank })
  }

  // Shorter names first inside a rank: `\in` before `\infty` for `in`, which is
  // the one the person who stopped typing after two letters meant.
  scored.sort((a, b) => a.rank - b.rank || a.command.name.length - b.command.name.length)
  return scored.map((s) => s.command)
}

/** Environments matching what has been typed, ranked the same way. */
export function findEnvironment(query: string): LatexEnvironment[] {
  const q = query.toLowerCase()
  if (!q) return LATEX_ENVIRONMENTS

  const scored: Array<{ env: LatexEnvironment; rank: number }> = []
  for (const env of LATEX_ENVIRONMENTS) {
    const rank = env.name.startsWith(q)
      ? 0
      : env.name.includes(q)
        ? 1
        : env.keywords.includes(q) || env.detail.toLowerCase().includes(q)
          ? 2
          : -1
    if (rank >= 0) scored.push({ env, rank })
  }
  scored.sort((a, b) => a.rank - b.rank)
  return scored.map((s) => s.env)
}
