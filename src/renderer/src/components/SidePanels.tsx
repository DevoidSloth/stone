import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { GraphData, NoteMeta, PropertyType } from '@shared/types'
import {
  isListValue,
  listFrontmatterKeys,
  readFrontmatterKey,
  readFrontmatterList,
  setFrontmatterKey,
  setFrontmatterList
} from '@shared/frontmatter'
import { RESERVED_KEYS } from '@shared/properties'
import { folderDefinedBy, homeFolder } from '@shared/folder-note'
import { useStone, type SidePanel } from '../store'
import { TranscriptPanel } from './TranscriptPanel'
import {
  IconComment,
  IconGraph,
  IconHistory,
  IconLink,
  IconOutline,
  IconPlus,
  IconProperties,
  IconRelation,
  IconRestore,
  IconTrash,
  IconWaveform,
  IconX
} from '../ui/icons'
import { describeError } from '../lib/errors'

/**
 * The right-hand inspector.
 *
 * Six panels over one note, switched by a rail of icons rather than stacked:
 * an outline and a backlink list and a property editor all visible at once
 * would each get a third of the height and none of them would be usable.
 */

const PANELS: { id: SidePanel; label: string; icon: (p: { size?: number }) => ReactElement }[] = [
  { id: 'outline', label: 'Outline', icon: IconOutline },
  { id: 'backlinks', label: 'Links', icon: IconLink },
  { id: 'properties', label: 'Properties', icon: IconProperties },
  { id: 'relations', label: 'Relations', icon: IconRelation },
  { id: 'comments', label: 'Comments', icon: IconComment },
  { id: 'localgraph', label: 'Local graph', icon: IconGraph },
  { id: 'history', label: 'Versions', icon: IconHistory },
  { id: 'transcript', label: 'Transcript', icon: IconWaveform }
]

// ---------------------------------------------------------------- relations

/**
 * Relations: the typed links this note is part of.
 *
 * Distinct from the Links panel, which answers "what mentions this?". A
 * relation answers "what mentions this, and as *what*?" — the frontmatter key
 * is the label on the edge. Both directions are shown, because the useful half
 * is usually the one nobody wrote: a project note never lists its own tasks,
 * and that incoming list is the thing you actually want when you open it.
 */
function RelationsPanel() {
  const relPath = useStone((s) => s.activeRelPath)
  const relations = useStone((s) => s.relations)
  const notes = useStone((s) => s.notes)
  const openNote = useStone((s) => s.openNote)

  const byPath = useMemo(() => new Map(notes.map((n) => [n.relPath, n])), [notes])

  const { outgoing, incoming } = useMemo(() => {
    const out = new Map<string, string[]>()
    const inc = new Map<string, string[]>()
    for (const edge of relations) {
      if (edge.from === relPath) out.set(edge.property, [...(out.get(edge.property) ?? []), edge.to])
      if (edge.to === relPath) inc.set(edge.property, [...(inc.get(edge.property) ?? []), edge.from])
    }
    return { outgoing: out, incoming: inc }
  }, [relations, relPath])

  if (!relPath) return <p className="panel__empty">Open a note to see its relations.</p>

  if (outgoing.size === 0 && incoming.size === 0) {
    return (
      <p className="panel__empty">
        No relations yet. Put a <code>[[link]]</code> in a frontmatter property — say{' '}
        <code>project: [[Website rebuild]]</code> — and both notes will show it here.
      </p>
    )
  }

  const group = (
    label: string,
    map: Map<string, string[]>,
    verb: string
  ): ReactElement | null => {
    if (map.size === 0) return null
    return (
      <>
        <div className="panel__section eyebrow">{label}</div>
        {[...map.entries()].map(([property, paths]) => (
          <div key={`${label}-${property}`} className="relgroup">
            <div className="relgroup__key">
              {verb} <b>{property}</b>
            </div>
            {[...new Set(paths)].map((path) => (
              <button
                key={path}
                type="button"
                className="panelrow"
                onClick={() => void openNote(path)}
              >
                <b className="truncate">{byPath.get(path)?.title ?? path}</b>
                <span className="panelrow__sub truncate">{byPath.get(path)?.excerpt ?? ''}</span>
              </button>
            ))}
          </div>
        ))}
      </>
    )
  }

  return (
    <>
      {group('Points at', outgoing, 'via')}
      {group('Pointed at by', incoming, 'as their')}
    </>
  )
}

// ------------------------------------------------------------------ outline

function OutlinePanel({ note }: { note: NoteMeta | null }) {
  const docs = useStone((s) => s.docs)
  const relPath = useStone((s) => s.activeRelPath)

  /*
   * Headings come from the live buffer rather than the index. The indexed copy
   * only catches up after autosave and a reindex, which made the outline lag a
   * second behind the heading you had just typed.
   */
  const headings = useMemo(() => {
    const content = relPath ? docs[relPath]?.content : null
    if (!content) return note?.headings ?? []
    const out: { level: number; text: string; line: number }[] = []
    let inFence = false
    content.split('\n').forEach((line, index) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence
        return
      }
      if (inFence) return
      const m = /^(#{1,6})\s+(.*)$/.exec(line)
      if (m) out.push({ level: m[1].length, text: m[2].trim(), line: index })
    })
    return out
  }, [docs, relPath, note])

  if (headings.length === 0) {
    return <p className="panel__empty">Headings appear here as you write them.</p>
  }

  const shallowest = Math.min(...headings.map((h) => h.level))

  return (
    <div className="outline">
      {headings.map((heading) => (
        <button
          key={`${heading.line}-${heading.text}`}
          type="button"
          className="outline__row truncate"
          style={{ paddingLeft: 8 + (heading.level - shallowest) * 13 }}
          data-level={heading.level}
          onClick={() => {
            if (relPath) void useStone.getState().openNote(relPath, { line: heading.line })
          }}
        >
          {heading.text || 'Untitled heading'}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- backlinks

function LinksPanel() {
  const backlinks = useStone((s) => s.backlinks)
  const mentions = useStone((s) => s.mentions)
  const openNote = useStone((s) => s.openNote)
  const activeRelPath = useStone((s) => s.activeRelPath)
  const notes = useStone((s) => s.notes)
  const docs = useStone((s) => s.docs)
  const setDoc = useStone((s) => s.setDoc)
  const toast = useStone((s) => s.toast)

  const title = activeRelPath
    ? (notes.find((n) => n.relPath === activeRelPath)?.title ??
      activeRelPath.split('/').pop()!.replace(/\.md$/, ''))
    : ''

  /** The folder this note defines, when it is a folder note. */
  const defines = activeRelPath ? folderDefinedBy(activeRelPath) : null
  const [contents, mentioned] = useMemo(() => {
    if (defines === null) return [[] as NoteMeta[], backlinks]
    const inside: NoteMeta[] = []
    const rest: NoteMeta[] = []
    for (const source of backlinks) {
      ;(homeFolder(source.relPath) === defines ? inside : rest).push(source)
    }
    return [inside, rest]
  }, [backlinks, defines])

  /** Turn a plain mention into a real `[[wikilink]]` in the mentioning note. */
  const link = async (relPath: string, line: number, text: string): Promise<void> => {
    const needle = new RegExp(`(?<!\\[)\\b${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b(?!\\])`, 'i')
    const next = text.replace(needle, `[[${title}]]`)
    if (next === text) {
      toast('That mention could not be rewritten automatically.', 'error')
      return
    }
    try {
      await window.stone.notes.replaceLine(relPath, line, next)
      // The buffer may be open in a pane; keep it in step with disk.
      if (docs[relPath]) {
        const lines = docs[relPath].content.split('\n')
        lines[line] = next
        setDoc(relPath, lines.join('\n'))
      }
      await useStone.getState().refreshVault()
      if (activeRelPath) await openNote(activeRelPath)
      toast('Linked.', 'success')
    } catch (err) {
      toast(describeError(err), 'error')
    }
  }

  const row = (source: NoteMeta): ReactElement => (
    <button
      key={source.relPath}
      type="button"
      className="panelrow"
      onClick={() => void openNote(source.relPath)}
    >
      <b className="truncate">{source.title}</b>
      <span className="panelrow__sub">{source.excerpt}</span>
    </button>
  )

  return (
    <>
      {/*
       * On a folder note the folder's own contents arrive as backlinks — they
       * are linked to it by containment. Listing them as "mentions" would be a
       * lie about where that link came from, so they get their own section.
       */}
      {defines !== null && (
        <>
          <div className="panel__section eyebrow">
            {contents.length} inside this folder
          </div>
          {contents.length === 0 && <p className="panel__empty">This folder is empty.</p>}
          {contents.map(row)}
        </>
      )}

      <div className="panel__section eyebrow">
        {mentioned.length} linked {mentioned.length === 1 ? 'mention' : 'mentions'}
      </div>
      {mentioned.length === 0 && (
        <p className="panel__empty">Nothing links here yet.</p>
      )}
      {mentioned.map(row)}

      <div className="panel__section eyebrow">
        {mentions.length} unlinked {mentions.length === 1 ? 'mention' : 'mentions'}
      </div>
      {mentions.length === 0 && (
        <p className="panel__empty">
          Notes that name this one without linking to it show up here.
        </p>
      )}
      {mentions.map((mention) => (
        <div key={`${mention.relPath}:${mention.line}`} className="panelrow panelrow--split">
          <button type="button" className="panelrow__main" onClick={() => void openNote(mention.relPath)}>
            <b className="truncate">{mention.title}</b>
            <span className="panelrow__sub">{mention.text}</span>
          </button>
          <button
            type="button"
            className="btn btn--sm"
            data-tip="Turn this mention into a link"
            onClick={() => void link(mention.relPath, mention.line, mention.text)}
          >
            Link
          </button>
        </div>
      ))}
    </>
  )
}

// --------------------------------------------------------------- properties

function inputTypeFor(type: PropertyType): string {
  if (type === 'number') return 'number'
  if (type === 'date') return 'date'
  if (type === 'url') return 'url'
  return 'text'
}

function PropertiesPanel() {
  const relPath = useStone((s) => s.activeRelPath)
  const docs = useStone((s) => s.docs)
  const setDoc = useStone((s) => s.setDoc)
  const schema = useStone((s) => s.properties)
  const [adding, setAdding] = useState(false)
  const [newKey, setNewKey] = useState('')

  const content = relPath ? docs[relPath]?.content : null
  if (!relPath || content == null) {
    return <p className="panel__empty">Open a note to edit its properties.</p>
  }

  const keys = listFrontmatterKeys(content).filter((k) => !RESERVED_KEYS.has(k))
  const typeOf = (key: string): PropertyType =>
    schema.find((p) => p.key === key)?.type ?? (isListValue(content, key) ? 'multi' : 'text')

  const setScalar = (key: string, value: string | null): void => {
    setDoc(relPath, setFrontmatterKey(content, key, value))
  }
  const setList = (key: string, values: string[]): void => {
    setDoc(relPath, setFrontmatterList(content, key, values))
  }

  const unused = schema.filter((p) => !keys.includes(p.key)).slice(0, 12)

  return (
    <>
      <div className="panel__section eyebrow">Properties</div>

      {keys.length === 0 && (
        <p className="panel__empty">
          Properties are ordinary frontmatter keys. Add one and it becomes a column you can
          filter a view by.
        </p>
      )}

      <div className="props">
        {keys.map((key) => {
          const type = typeOf(key)
          const def = schema.find((p) => p.key === key)

          return (
            <div key={key} className="props__row">
              <label className="props__key truncate" htmlFor={`prop-${key}`} data-tip={key}>
                {key}
              </label>

              {type === 'checkbox' ? (
                <input
                  id={`prop-${key}`}
                  type="checkbox"
                  className="props__check"
                  checked={readFrontmatterKey(content, key) === 'true'}
                  onChange={(e) => setScalar(key, e.target.checked ? 'true' : 'false')}
                />
              ) : type === 'multi' ? (
                <input
                  id={`prop-${key}`}
                  className="field props__value"
                  value={readFrontmatterList(content, key).join(', ')}
                  placeholder="a, b, c"
                  onChange={(e) => setList(key, e.target.value.split(','))}
                />
              ) : type === 'select' && def && def.options.length > 0 ? (
                <input
                  id={`prop-${key}`}
                  className="field props__value"
                  list={`prop-options-${key}`}
                  value={readFrontmatterKey(content, key) ?? ''}
                  onChange={(e) => setScalar(key, e.target.value || null)}
                />
              ) : (
                <input
                  id={`prop-${key}`}
                  className="field props__value"
                  type={inputTypeFor(type)}
                  value={readFrontmatterKey(content, key) ?? ''}
                  onChange={(e) => setScalar(key, e.target.value || null)}
                />
              )}

              {type === 'select' && def && (
                <datalist id={`prop-options-${key}`}>
                  {def.options.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              )}

              <button
                type="button"
                className="btn btn--ghost btn--sm btn--icon props__remove"
                aria-label={`Remove ${key}`}
                onClick={() => setScalar(key, null)}
              >
                <IconX size={12} />
              </button>
            </div>
          )
        })}
      </div>

      {adding ? (
        <div className="props__add">
          <input
            className="field"
            autoFocus
            placeholder="Property name"
            value={newKey}
            list="prop-known-keys"
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newKey.trim()) {
                setScalar(newKey.trim().replace(/\s+/g, '-'), '')
                setNewKey('')
                setAdding(false)
              }
              if (e.key === 'Escape') {
                setNewKey('')
                setAdding(false)
              }
            }}
          />
          <datalist id="prop-known-keys">
            {unused.map((p) => (
              <option key={p.key} value={p.key}>
                {p.type}
              </option>
            ))}
          </datalist>
        </div>
      ) : (
        <button type="button" className="btn btn--sm panel__add" onClick={() => setAdding(true)}>
          <IconPlus size={13} />
          Add a property
        </button>
      )}
    </>
  )
}

// ----------------------------------------------------------------- comments

function CommentsPanel() {
  const comments = useStone((s) => s.comments)
  const addComment = useStone((s) => s.addComment)
  const updateComment = useStone((s) => s.updateComment)
  const removeComment = useStone((s) => s.removeComment)
  const loadComments = useStone((s) => s.loadComments)
  const relPath = useStone((s) => s.activeRelPath)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    void loadComments()
  }, [relPath, loadComments])

  if (!relPath) return <p className="panel__empty">Open a note to comment on it.</p>

  const open = comments.filter((c) => !c.resolved)
  const resolved = comments.filter((c) => c.resolved)

  const submit = (): void => {
    if (!draft.trim()) return
    // Whatever is selected in the editor becomes the quoted anchor.
    const anchor = window.getSelection()?.toString().trim() ?? ''
    void addComment(anchor, draft)
    setDraft('')
  }

  return (
    <>
      <div className="panel__section eyebrow">
        {open.length} open {open.length === 1 ? 'comment' : 'comments'}
      </div>

      <div className="comment__compose">
        <textarea
          className="field comment__input"
          rows={3}
          placeholder="Select text in the note, then comment on it…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <button type="button" className="btn btn--primary btn--sm" onClick={submit} disabled={!draft.trim()}>
          Comment
        </button>
      </div>

      {open.map((comment) => (
        <div key={comment.id} className="comment">
          {comment.anchor && <blockquote className="comment__anchor">{comment.anchor}</blockquote>}
          <p className="comment__body">{comment.body}</p>
          <div className="comment__foot">
            <span>{new Date(comment.createdAt).toLocaleDateString()}</span>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => void updateComment(comment.id, { resolved: true })}
            >
              Resolve
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm btn--icon"
              aria-label="Delete comment"
              onClick={() => void removeComment(comment.id)}
            >
              <IconTrash size={12} />
            </button>
          </div>
        </div>
      ))}

      {resolved.length > 0 && (
        <>
          <div className="panel__section eyebrow">{resolved.length} resolved</div>
          {resolved.map((comment) => (
            <div key={comment.id} className="comment comment--resolved">
              <p className="comment__body">{comment.body}</p>
              <div className="comment__foot">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => void updateComment(comment.id, { resolved: false })}
                >
                  Reopen
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm btn--icon"
                  aria-label="Delete comment"
                  onClick={() => void removeComment(comment.id)}
                >
                  <IconTrash size={12} />
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </>
  )
}

// -------------------------------------------------------------- local graph

/**
 * The neighbourhood of the open note, laid out on a small circle rather than
 * simulated. At the sizes a side panel allows, a force layout spends its time
 * settling into what a ring would have given immediately.
 */
function LocalGraphPanel() {
  const graph = useStone((s) => s.localGraph)
  const relPath = useStone((s) => s.activeRelPath)
  const openNote = useStone((s) => s.openNote)
  const loadLocalGraph = useStone((s) => s.loadLocalGraph)

  useEffect(() => {
    void loadLocalGraph()
  }, [relPath, loadLocalGraph])

  if (!graph || graph.nodes.length <= 1) {
    return <p className="panel__empty">This note has no links yet.</p>
  }

  return <GraphRing graph={graph} centre={relPath} onOpen={(p) => void openNote(p)} />
}

function GraphRing({
  graph,
  centre,
  onOpen
}: {
  graph: GraphData
  centre: string | null
  onOpen: (relPath: string) => void
}) {
  const size = 240
  const middle = size / 2
  const others = graph.nodes.filter((n) => n.relPath !== centre)
  const radius = others.length > 8 ? 92 : 74

  const position = new Map<string, { x: number; y: number }>()
  if (centre) position.set(centre, { x: middle, y: middle })
  others.forEach((node, index) => {
    const angle = (index / others.length) * Math.PI * 2 - Math.PI / 2
    position.set(node.relPath, {
      x: middle + Math.cos(angle) * radius,
      y: middle + Math.sin(angle) * radius
    })
  })

  return (
    <svg className="localgraph" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Local graph">
      {graph.edges.map((edge, index) => {
        const a = position.get(edge.source)
        const b = position.get(edge.target)
        if (!a || !b) return null
        return (
          <line
            key={index}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            className="localgraph__edge"
          />
        )
      })}
      {graph.nodes.map((node) => {
        const point = position.get(node.relPath)
        if (!point) return null
        const isCentre = node.relPath === centre
        return (
          <g
            key={node.relPath}
            className={`localgraph__node ${isCentre ? 'localgraph__node--centre' : ''}`}
            onClick={() => !isCentre && onOpen(node.relPath)}
          >
            <circle cx={point.x} cy={point.y} r={isCentre ? 7 : 4.5} />
            <title>{node.title}</title>
            <text x={point.x} y={point.y + (isCentre ? 20 : 16)} textAnchor="middle">
              {node.title.length > 16 ? `${node.title.slice(0, 15)}…` : node.title}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ---------------------------------------------------------------- snapshots

function HistoryPanel() {
  const snapshots = useStone((s) => s.snapshots)
  const loadSnapshots = useStone((s) => s.loadSnapshots)
  const restoreSnapshot = useStone((s) => s.restoreSnapshot)
  const relPath = useStone((s) => s.activeRelPath)
  const [preview, setPreview] = useState<{ id: string; body: string } | null>(null)

  useEffect(() => {
    void loadSnapshots()
    setPreview(null)
  }, [relPath, loadSnapshots])

  if (!relPath) return <p className="panel__empty">Open a note to see its history.</p>
  if (snapshots.length === 0) {
    return (
      <p className="panel__empty">
        Versions are kept each time a note is saved with different content. This one has no
        earlier copies yet.
      </p>
    )
  }

  return (
    <>
      <div className="panel__section eyebrow">{snapshots.length} earlier versions</div>
      {snapshots.map((snapshot) => (
        <div key={snapshot.id} className="version">
          <button
            type="button"
            className="version__main"
            onClick={() => {
              if (preview?.id === snapshot.id) {
                setPreview(null)
                return
              }
              void window.stone.snapshots.read(relPath, snapshot.id).then((body) => {
                if (body !== null) setPreview({ id: snapshot.id, body })
              })
            }}
          >
            <b>{new Date(snapshot.savedAt).toLocaleString()}</b>
            <span>{(snapshot.size / 1024).toFixed(1)} kB</span>
          </button>
          <button
            type="button"
            className="btn btn--sm"
            data-tip="Replace the note with this version"
            onClick={() => void restoreSnapshot(snapshot.id)}
          >
            <IconRestore size={12} />
            Restore
          </button>
          {preview?.id === snapshot.id && <pre className="version__preview">{preview.body}</pre>}
        </div>
      ))}
    </>
  )
}

// ------------------------------------------------------------------- shell

export function SidePanels() {
  const panel = useStone((s) => s.sidePanel)
  const open = useStone((s) => s.panelOpen)
  const setSidePanel = useStone((s) => s.setSidePanel)
  const togglePanel = useStone((s) => s.togglePanel)
  const relPath = useStone((s) => s.activeRelPath)
  const notes = useStone((s) => s.notes)
  const note = useMemo(
    () => notes.find((n) => n.relPath === relPath) ?? null,
    [notes, relPath]
  )

  return (
    <div className={`inspector ${open ? '' : 'inspector--collapsed'}`}>
      <div className="inspector__rail">
        {PANELS.map(({ id, label, icon: Glyph }) => (
          <button
            key={id}
            type="button"
            className="inspector__tab"
            aria-pressed={open && panel === id}
            data-tip={label}
            aria-label={label}
            onClick={() => (open && panel === id ? togglePanel() : setSidePanel(id))}
          >
            <Glyph size={15} />
          </button>
        ))}
      </div>

      {open && (
        <div className="inspector__body">
          <div className="inspector__head">
            <span className="eyebrow">{PANELS.find((p) => p.id === panel)?.label}</span>
            <button
              type="button"
              className="btn btn--ghost btn--sm btn--icon"
              aria-label="Close panel"
              onClick={togglePanel}
            >
              <IconX size={13} />
            </button>
          </div>

          <div className="inspector__scroll">
            {panel === 'outline' && <OutlinePanel note={note} />}
            {panel === 'backlinks' && <LinksPanel />}
            {panel === 'properties' && <PropertiesPanel />}
            {panel === 'relations' && <RelationsPanel />}
            {panel === 'comments' && <CommentsPanel />}
            {panel === 'localgraph' && <LocalGraphPanel />}
            {panel === 'history' && <HistoryPanel />}
            {panel === 'transcript' && <TranscriptPanel />}
          </div>
        </div>
      )}
    </div>
  )
}

/** A small floating card shown when a wikilink is hovered. */
export function HoverPreview({
  target,
  rect,
  onClose
}: {
  target: string
  rect: DOMRect
  onClose: () => void
}) {
  const [body, setBody] = useState<string | null>(null)
  const [title, setTitle] = useState(target)
  const card = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    void window.stone.notes.resolveLink(target).then(async (hit) => {
      if (!hit || !live) return
      const note = await window.stone.notes.get(hit.relPath)
      if (!note || !live) return
      setTitle(note.title)
      setBody(note.content.replace(/^---[\s\S]*?---\n?/, '').trim().slice(0, 600))
    })
    return () => {
      live = false
    }
  }, [target])

  // Keep the card on screen when the link sits near the bottom edge.
  const top = Math.min(rect.bottom + 8, window.innerHeight - 260)
  const left = Math.min(rect.left, window.innerWidth - 380)

  return (
    <div
      ref={card}
      className="hovercard"
      style={{ top, left }}
      onMouseLeave={onClose}
      role="tooltip"
    >
      <b className="hovercard__title truncate">{title}</b>
      <p className="hovercard__body">{body ?? 'Loading…'}</p>
    </div>
  )
}
