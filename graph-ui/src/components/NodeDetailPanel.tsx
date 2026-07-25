import { useMemo, useState, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { colorForLabel } from "../lib/colors";
import { callTool } from "../api/rpc";
import type { GraphNode, GraphEdge, RepoInfo } from "../lib/types";

interface Connection {
  node: GraphNode;
  edgeType: string;
  direction: "inbound" | "outbound";
}

interface NodeDetailPanelProps {
  node: GraphNode;
  allNodes: GraphNode[];
  allEdges: GraphEdge[];
  project: string | null;
  repoInfo: RepoInfo | null;
  onClose: () => void;
  onNavigate: (node: GraphNode) => void;
}

interface SnippetResult {
  source?: string;
  start_line?: number;
  end_line?: number;
}

/* External per-node metadata loaded via import_annotations: facts no syntax tree
 * can yield — an elaborated hardware instance path, a resolved width, a profiler
 * count — namespaced by the tool that produced them. */
interface AnnotationRow {
  source?: string;
  props?: Record<string, unknown>;
}

interface AnnotationsResult {
  annotations?: AnnotationRow[];
}

/* One line per annotation value. Props are arbitrary JSON, so a value may be a
 * nested object or array (a struct's field list, an enum's members); stringify
 * those instead of printing "[object Object]". */
function annotationValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

function lineSuffix(node: GraphNode): string {
  if (!node.start_line) return "";
  const end = node.end_line && node.end_line !== node.start_line ? `-L${node.end_line}` : "";
  return `#L${node.start_line}${end}`;
}

/* Encode each path segment so an unusual file_path can't break (or escape) the
 * URL. The scheme is already https-forced by the backend (/api/repo-info);
 * this is defense-in-depth on the path. */
function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

/* GitHub (or GitLab) deep-link, or null when we lack remote/path/line info. */
function githubUrl(node: GraphNode, repoInfo: RepoInfo | null): string | null {
  if (!repoInfo?.blob_base || !node.file_path) return null;
  return `${repoInfo.blob_base}/${encodePath(node.file_path)}${lineSuffix(node)}`;
}

export function NodeDetailPanel({
  node,
  allNodes,
  allEdges,
  project,
  repoInfo,
  onClose,
  onNavigate,
}: NodeDetailPanelProps) {
  const [code, setCode] = useState<string | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<AnnotationRow[]>([]);

  /* Reset the fetched code whenever the selected node changes. */
  useEffect(() => {
    setCode(null);
    setCodeError(null);
    setCodeLoading(false);
  }, [node.id]);

  /* Annotations load EAGERLY, unlike the code snippet: a snippet can be hundreds
   * of lines (hence the explicit "Show code"), while a node's annotations are a
   * handful of scalars behind one indexed lookup — and they are the facts you
   * cannot recover by reading the source, so making the user ask for them
   * defeats the point.
   *
   * Failures are swallowed on purpose: an engine without the annotations feature
   * rejects the tool outright, and a node simply having none is the common case.
   * Neither is worth an error in the panel — the block just doesn't render. */
  useEffect(() => {
    let cancelled = false;
    setAnnotations([]);
    if (!project || !node.qualified_name) return;
    void (async () => {
      try {
        const res = await callTool<AnnotationsResult>("get_annotations", {
          project,
          qualified_name: node.qualified_name,
        });
        if (!cancelled) setAnnotations(res.annotations ?? []);
      } catch {
        if (!cancelled) setAnnotations([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [node.id, node.qualified_name, project]);

  const canFetchCode = Boolean(project && node.qualified_name);
  const ghUrl = githubUrl(node, repoInfo);

  const loadCode = async () => {
    if (!project || !node.qualified_name) return;
    setCodeLoading(true);
    setCodeError(null);
    try {
      const res = await callTool<SnippetResult>("get_code_snippet", {
        qualified_name: node.qualified_name,
        project,
      });
      setCode(res.source ?? "(source not available)");
    } catch (e) {
      setCodeError(e instanceof Error ? e.message : "Failed to load code");
    } finally {
      setCodeLoading(false);
    }
  };

  const connections = useMemo(() => {
    const nodeMap = new Map<number, GraphNode>();
    for (const n of allNodes) nodeMap.set(n.id, n);
    const conns: Connection[] = [];
    for (const edge of allEdges) {
      if (edge.source === node.id) {
        const t = nodeMap.get(edge.target);
        if (t) conns.push({ node: t, edgeType: edge.type, direction: "outbound" });
      }
      if (edge.target === node.id) {
        const s = nodeMap.get(edge.source);
        if (s) conns.push({ node: s, edgeType: edge.type, direction: "inbound" });
      }
    }
    return conns;
  }, [node, allNodes, allEdges]);

  const outbound = connections.filter((c) => c.direction === "outbound");
  const inbound = connections.filter((c) => c.direction === "inbound");

  const groupByType = (conns: Connection[]) => {
    const g = new Map<string, Connection[]>();
    for (const c of conns) g.set(c.edgeType, [...(g.get(c.edgeType) ?? []), c]);
    return [...g.entries()].sort((a, b) => b[1].length - a[1].length);
  };

  return (
    <div className="w-full bg-[#0b1920]/95 backdrop-blur-xl flex flex-col h-full min-h-0 overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-border/30">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorForLabel(node.label) }} />
              <h3 className="text-[13px] font-semibold text-foreground truncate">{node.name}</h3>
            </div>
            <span
              className="inline-block px-2 py-0.5 rounded-md text-[10px] font-medium"
              style={{ backgroundColor: colorForLabel(node.label) + "18", color: colorForLabel(node.label) }}
            >
              {node.label}
            </span>
          </div>
          <button onClick={onClose} className="text-foreground/20 hover:text-foreground/50 transition-colors text-[16px] leading-none p-1">×</button>
        </div>

        {node.file_path && (
          <p className="text-[11px] text-foreground/30 font-mono mt-2 break-all leading-relaxed">
            {node.file_path}
            {node.start_line ? (
              <span className="text-foreground/45">
                {" "}:{node.start_line}
                {node.end_line && node.end_line !== node.start_line ? `-${node.end_line}` : ""}
              </span>
            ) : null}
          </p>
        )}

        {/* Code actions */}
        <div className="flex flex-wrap items-center gap-2 mt-2.5">
          {canFetchCode && (
            <button
              onClick={code ? () => setCode(null) : loadCode}
              disabled={codeLoading}
              className="px-2.5 py-1 rounded-md bg-primary/15 text-primary text-[11px] font-medium hover:bg-primary/25 transition-colors disabled:opacity-50"
            >
              {codeLoading ? "Loading…" : code ? "Hide code" : "Show code"}
            </button>
          )}
          {ghUrl && (
            <a
              href={ghUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2.5 py-1 rounded-md bg-white/[0.05] text-foreground/60 text-[11px] font-medium hover:bg-white/[0.09] hover:text-foreground/90 transition-colors"
            >
              Open on GitHub ↗
            </a>
          )}
        </div>

        {codeError && <p className="text-[11px] text-red-400/80 mt-2">{codeError}</p>}
        {code && (
          <pre className="mt-2 max-h-[300px] overflow-auto rounded-md bg-black/40 border border-white/[0.06] p-2.5 text-[10.5px] leading-relaxed font-mono text-foreground/75 whitespace-pre">
            {code}
          </pre>
        )}

        {/* Stats */}
        <div className="flex gap-5 mt-3">
          {[
            { label: "Out", value: outbound.length, color: "text-primary" },
            { label: "In", value: inbound.length, color: "text-accent" },
            { label: "Total", value: connections.length, color: "text-foreground" },
          ].map((s) => (
            <div key={s.label}>
              <p className="text-[9px] text-foreground/25 uppercase tracking-widest">{s.label}</p>
              <p className={`text-[18px] font-semibold tabular-nums ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Annotations + connections */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-4 py-3 space-y-4">
          {annotations.length > 0 && (
            <div data-testid="node-annotations">
              <p className="text-[11px] font-medium text-foreground/40 mb-2">
                Annotations
              </p>
              {annotations.map((ann, i) => (
                <div
                  key={`${ann.source ?? "annotation"}-${i}`}
                  className="mb-2 rounded-md border border-emerald-400/25 bg-emerald-400/[0.05] p-2.5"
                >
                  {ann.source && (
                    <p className="text-[9.5px] text-emerald-300/60 font-mono mb-1.5 break-all">
                      {ann.source}
                    </p>
                  )}
                  <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1">
                    {Object.entries(ann.props ?? {}).map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-[10.5px] text-foreground/35 font-mono">{k}</dt>
                        <dd className="text-[10.5px] text-foreground/80 font-mono break-all">
                          {annotationValue(v)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          )}
          {outbound.length > 0 && (
            <ConnectionSection title="References" count={outbound.length} icon="→" groups={groupByType(outbound)} onNavigate={onNavigate} />
          )}
          {inbound.length > 0 && (
            <ConnectionSection title="Referenced by" count={inbound.length} icon="←" groups={groupByType(inbound)} onNavigate={onNavigate} />
          )}
          {connections.length === 0 && (
            <p className="text-[12px] text-foreground/20 text-center py-8">No connections</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function ConnectionSection({ title, count, icon, groups, onNavigate }: {
  title: string; count: number; icon: string;
  groups: [string, Connection[]][];
  onNavigate: (n: GraphNode) => void;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium text-foreground/40 mb-2">
        {title} <span className="text-foreground/15">({count})</span>
      </p>
      {groups.map(([type, conns]) => (
        <div key={type} className="mb-2">
          <p className="text-[9px] text-foreground/20 uppercase tracking-wider mb-1 font-medium">
            {type.replace(/_/g, " ").toLowerCase()}
          </p>
          <div className="space-y-px">
            {conns.slice(0, 25).map((c, i) => (
              <button
                key={`${c.node.id}-${i}`}
                onClick={() => onNavigate(c.node)}
                className="flex items-center gap-1.5 w-full text-left px-2 py-[4px] rounded-md hover:bg-white/[0.04] text-[11px] transition-colors group"
              >
                <span className="text-foreground/15 text-[10px] group-hover:text-foreground/30">{icon}</span>
                <span className="w-[5px] h-[5px] rounded-full shrink-0" style={{ backgroundColor: colorForLabel(c.node.label) }} />
                <span className="text-foreground/55 group-hover:text-foreground/80 truncate">{c.node.name}</span>
                <span className="text-foreground/10 ml-auto text-[10px] shrink-0">{c.node.label}</span>
              </button>
            ))}
            {conns.length > 25 && (
              <p className="text-[10px] text-foreground/15 px-2 py-1">+{conns.length - 25} more</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
