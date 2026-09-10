/**
 * Emoji by name, for the `:shortcode:` menu.
 *
 * What goes into the document is the character itself, never the shortcode.
 * `:tada:` is a convention some renderers understand and most do not; 🎉 is a
 * character, and a note full of characters reads the same in Obsidian, in a
 * terminal, and in a diff. The typing shorthand is worth having; the storage
 * format is not.
 *
 * The list is deliberately a few hundred rather than the full set. A picker
 * that has everything needs categories, skin tones, search ranking and a grid;
 * this is a completion menu, and its job is to answer the twenty emoji people
 * actually reach for while writing without ever being in the way.
 */

export interface Emoji {
  char: string
  /** The shortcode, without its colons. */
  name: string
  /** Extra words the menu should match on. */
  keywords?: string
}

export const EMOJI: Emoji[] = [
  // --- faces and people
  { char: '😀', name: 'grinning', keywords: 'smile happy' },
  { char: '😄', name: 'smile', keywords: 'happy joy' },
  { char: '😅', name: 'sweat_smile', keywords: 'relief phew' },
  { char: '😂', name: 'joy', keywords: 'laugh crying tears' },
  { char: '🙂', name: 'slightly_smiling_face', keywords: 'smile' },
  { char: '😉', name: 'wink' },
  { char: '😊', name: 'blush', keywords: 'smile happy' },
  { char: '😍', name: 'heart_eyes', keywords: 'love' },
  { char: '🤔', name: 'thinking', keywords: 'hmm consider' },
  { char: '🤨', name: 'raised_eyebrow', keywords: 'sceptical doubt' },
  { char: '😐', name: 'neutral_face', keywords: 'meh' },
  { char: '🙄', name: 'roll_eyes' },
  { char: '😴', name: 'sleeping', keywords: 'tired zzz' },
  { char: '😢', name: 'cry', keywords: 'sad tear' },
  { char: '😭', name: 'sob', keywords: 'cry sad' },
  { char: '😤', name: 'triumph', keywords: 'determined' },
  { char: '😱', name: 'scream', keywords: 'fear shock' },
  { char: '🤯', name: 'exploding_head', keywords: 'mind blown' },
  { char: '😬', name: 'grimacing', keywords: 'awkward' },
  { char: '🥳', name: 'partying_face', keywords: 'celebrate' },
  { char: '😎', name: 'sunglasses', keywords: 'cool' },
  { char: '🤝', name: 'handshake', keywords: 'deal agree' },
  { char: '👋', name: 'wave', keywords: 'hello hi bye' },
  { char: '👍', name: 'thumbsup', keywords: 'yes approve +1 ok' },
  { char: '👎', name: 'thumbsdown', keywords: 'no reject -1' },
  { char: '👏', name: 'clap', keywords: 'applause well done' },
  { char: '🙏', name: 'pray', keywords: 'thanks please' },
  { char: '💪', name: 'muscle', keywords: 'strong' },
  { char: '🫡', name: 'salute', keywords: 'yes sir understood' },
  { char: '👀', name: 'eyes', keywords: 'look watching' },
  { char: '🧠', name: 'brain', keywords: 'think mind' },

  // --- work and status
  { char: '✅', name: 'white_check_mark', keywords: 'done tick complete yes' },
  { char: '☑️', name: 'ballot_box_with_check', keywords: 'done checkbox' },
  { char: '❌', name: 'x', keywords: 'no wrong cancel fail' },
  { char: '⚠️', name: 'warning', keywords: 'caution careful' },
  { char: '🚨', name: 'rotating_light', keywords: 'alert urgent siren' },
  { char: '🔥', name: 'fire', keywords: 'hot urgent burning' },
  { char: '⭐', name: 'star', keywords: 'favourite important' },
  { char: '🌟', name: 'star2', keywords: 'sparkle shine' },
  { char: '✨', name: 'sparkles', keywords: 'new magic polish' },
  { char: '💡', name: 'bulb', keywords: 'idea insight' },
  { char: '🎯', name: 'dart', keywords: 'target goal aim' },
  { char: '🚀', name: 'rocket', keywords: 'ship launch fast' },
  { char: '🐛', name: 'bug', keywords: 'defect issue' },
  { char: '🔧', name: 'wrench', keywords: 'fix tool' },
  { char: '🔨', name: 'hammer', keywords: 'build' },
  { char: '⚙️', name: 'gear', keywords: 'settings config' },
  { char: '🧪', name: 'test_tube', keywords: 'experiment test' },
  { char: '🔍', name: 'mag', keywords: 'search find look' },
  { char: '📌', name: 'pushpin', keywords: 'pin important' },
  { char: '📍', name: 'round_pushpin', keywords: 'location place' },
  { char: '🔗', name: 'link', keywords: 'url chain' },
  { char: '📎', name: 'paperclip', keywords: 'attach' },
  { char: '🏷️', name: 'label', keywords: 'tag' },
  { char: '📝', name: 'memo', keywords: 'note write draft' },
  { char: '📄', name: 'page_facing_up', keywords: 'document file' },
  { char: '📁', name: 'file_folder', keywords: 'folder directory' },
  { char: '📚', name: 'books', keywords: 'reading library' },
  { char: '📖', name: 'book', keywords: 'reading study' },
  { char: '📊', name: 'bar_chart', keywords: 'graph data stats' },
  { char: '📈', name: 'chart_up', keywords: 'growth increase' },
  { char: '📉', name: 'chart_down', keywords: 'decline decrease' },
  { char: '🗓️', name: 'calendar', keywords: 'date schedule' },
  { char: '⏰', name: 'alarm_clock', keywords: 'time reminder' },
  { char: '⏳', name: 'hourglass', keywords: 'waiting time pending' },
  { char: '🕐', name: 'clock', keywords: 'time' },
  { char: '💬', name: 'speech_balloon', keywords: 'comment talk' },
  { char: '📣', name: 'mega', keywords: 'announce shout' },
  { char: '📮', name: 'postbox', keywords: 'inbox send' },
  { char: '✉️', name: 'envelope', keywords: 'mail email' },
  { char: '💰', name: 'moneybag', keywords: 'cost budget cash' },
  { char: '💳', name: 'credit_card', keywords: 'payment' },
  { char: '⚡', name: 'zap', keywords: 'fast lightning power' },
  { char: '🧩', name: 'puzzle', keywords: 'piece plugin extension' },
  { char: '🗑️', name: 'wastebasket', keywords: 'delete bin trash' },
  { char: '♻️', name: 'recycle', keywords: 'refactor reuse' },
  { char: '🔒', name: 'lock', keywords: 'secure private' },
  { char: '🔑', name: 'key', keywords: 'password access' },
  { char: '🛠️', name: 'hammer_and_wrench', keywords: 'tools build fix' },
  { char: '📦', name: 'package', keywords: 'box ship release' },
  { char: '🧭', name: 'compass', keywords: 'direction navigate' },
  { char: '🪄', name: 'magic_wand', keywords: 'magic auto' },

  // --- arrows and marks
  { char: '➡️', name: 'arrow_right' },
  { char: '⬅️', name: 'arrow_left' },
  { char: '⬆️', name: 'arrow_up' },
  { char: '⬇️', name: 'arrow_down' },
  { char: '🔁', name: 'repeat', keywords: 'loop recurring' },
  { char: '❓', name: 'question', keywords: 'unknown ask' },
  { char: '❗', name: 'exclamation', keywords: 'important' },
  { char: '💯', name: '100', keywords: 'perfect score' },
  { char: '🆗', name: 'ok' },
  { char: '🆕', name: 'new' },
  { char: '🔝', name: 'top' },

  // --- nature, food, objects
  { char: '☀️', name: 'sunny', keywords: 'sun weather clear' },
  { char: '🌧️', name: 'rain', keywords: 'weather wet' },
  { char: '❄️', name: 'snowflake', keywords: 'cold winter' },
  { char: '🌱', name: 'seedling', keywords: 'growth new plant' },
  { char: '🌳', name: 'tree', keywords: 'nature' },
  { char: '🌊', name: 'wave_water', keywords: 'sea ocean' },
  { char: '🌍', name: 'earth', keywords: 'world globe' },
  { char: '🌙', name: 'crescent_moon', keywords: 'night' },
  { char: '☕', name: 'coffee', keywords: 'break morning' },
  { char: '🍵', name: 'tea' },
  { char: '🍕', name: 'pizza', keywords: 'food' },
  { char: '🎂', name: 'cake', keywords: 'birthday' },
  { char: '🍺', name: 'beer', keywords: 'drink' },
  { char: '🎉', name: 'tada', keywords: 'celebrate party done shipped' },
  { char: '🎈', name: 'balloon', keywords: 'party' },
  { char: '🎁', name: 'gift', keywords: 'present' },
  { char: '🏆', name: 'trophy', keywords: 'win award' },
  { char: '🥇', name: 'first_place', keywords: 'gold win' },
  { char: '🎵', name: 'musical_note', keywords: 'music song' },
  { char: '🎧', name: 'headphones', keywords: 'audio listen' },
  { char: '🎤', name: 'microphone', keywords: 'record audio speak' },
  { char: '📷', name: 'camera', keywords: 'photo picture' },
  { char: '🎬', name: 'clapper', keywords: 'film video' },
  { char: '🖥️', name: 'desktop', keywords: 'computer screen' },
  { char: '💻', name: 'laptop', keywords: 'computer code' },
  { char: '📱', name: 'phone', keywords: 'mobile' },
  { char: '⌨️', name: 'keyboard', keywords: 'typing shortcut' },
  { char: '🖊️', name: 'pen', keywords: 'write' },
  { char: '✏️', name: 'pencil', keywords: 'write edit draft' },
  { char: '📐', name: 'triangular_ruler', keywords: 'design measure' },
  { char: '🧵', name: 'thread', keywords: 'sequence series' },
  { char: '🪶', name: 'feather', keywords: 'light writing' },

  // --- symbols
  { char: '❤️', name: 'heart', keywords: 'love red' },
  { char: '💙', name: 'blue_heart' },
  { char: '💚', name: 'green_heart' },
  { char: '💛', name: 'yellow_heart' },
  { char: '💜', name: 'purple_heart' },
  { char: '🖤', name: 'black_heart' },
  { char: '🔴', name: 'red_circle', keywords: 'stop blocked' },
  { char: '🟠', name: 'orange_circle' },
  { char: '🟡', name: 'yellow_circle', keywords: 'at risk' },
  { char: '🟢', name: 'green_circle', keywords: 'go on track' },
  { char: '🔵', name: 'blue_circle' },
  { char: '⚫', name: 'black_circle' },
  { char: '⚪', name: 'white_circle' },
  { char: '🔶', name: 'orange_diamond' },
  { char: '▶️', name: 'play', keywords: 'start run' },
  { char: '⏸️', name: 'pause', keywords: 'hold' },
  { char: '⏹️', name: 'stop' },
  { char: '♾️', name: 'infinity', keywords: 'forever' },
  { char: '™️', name: 'tm' },
  { char: '©️', name: 'copyright' }
]

/** Shortcodes matching a typed prefix, best first. A blank query gives all. */
export function findEmoji(query: string): Emoji[] {
  const needle = query.toLowerCase()
  if (!needle) return EMOJI
  const starts: Emoji[] = []
  const contains: Emoji[] = []
  for (const emoji of EMOJI) {
    if (emoji.name.startsWith(needle)) starts.push(emoji)
    else if (emoji.name.includes(needle) || emoji.keywords?.includes(needle)) contains.push(emoji)
  }
  return [...starts, ...contains]
}
