// Large-PDF splitter panel (Admin → Content → Splitter).
//
// Lists every content item whose file is at/above the 30MB threshold but
// which has no pdfChunks manifest yet (the retroactive backlog), and runs
// the splitting pipeline on demand: download original from R2 → split into
// sequential ~12MB chunk PDFs → upload chunks → write the manifest.
// The reader picks chunked mode up automatically the moment the manifest
// exists. Idempotent: a failed run can simply be re-run.
//
// The Biology STB (171.8MB) was processed via this pipeline (CLI path);
// this panel exists so any future oversized import is one click away.
import { useCallback, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { SplitBacklogItem } from "@/convex/pdfSplitter";
import { Loader2, Scissors, CheckCircle2, AlertTriangle, FileWarning } from "lucide-react";
import { toast } from "sonner";

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PdfSplitterPanel() {
  const listBacklog = useAction(api.pdfSplitter.adminListSplitBacklog);
  const splitOne = useAction(api.pdfSplitter.adminSplitLargePdf);

  const [backlog, setBacklog] = useState<SplitBacklogItem[] | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setLoadingList(true);
    try {
      const items = await listBacklog({});
      setBacklog(items);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't load the split backlog.");
      setBacklog([]);
    } finally {
      setLoadingList(false);
    }
  }, [listBacklog]);

  const runSplit = useCallback(
    async (item: SplitBacklogItem) => {
      setRunningId(item._id);
      try {
        const result = await splitOne({ contentId: item._id as never });
        if ("skipped" in result) {
          setDone((d) => ({ ...d, [item._id]: result.reason }));
        } else if (result.alreadySplit) {
          setDone((d) => ({ ...d, [item._id]: `Already split (${result.chunkCount} parts)` }));
        } else {
          setDone((d) => ({
            ...d,
            [item._id]: `Split into ${result.chunkCount} parts (~${mb(result.totalChunkBytes)} total) in ${Math.round(result.durationMs / 1000)}s`,
          }));
        }
        toast.success("Split complete — the reader will now stream only the pages being read.");
        void refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Split failed — safe to retry.");
      } finally {
        setRunningId(null);
      }
    },
    [splitOne, refresh],
  );

  return (
    <div className="glass-panel grid gap-4 rounded-2xl p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Scissors className="size-4 text-primary" /> Large PDF splitter
          </h3>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
            Files at/above 30 MB are split once into sequential ~12 MB parts stored in R2. The
            reader then fetches only the part containing the page being read (IndexedDB-cached,
            next part pre-fetched) instead of streaming the whole file. This is the retroactive
            backlog — new uploads split automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loadingList}
          className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-white/10 disabled:opacity-50"
        >
          {loadingList ? <Loader2 className="size-3.5 animate-spin" /> : <Scissors className="size-3.5" />}
          {backlog === null ? "Load backlog" : "Refresh"}
        </button>
      </div>

      {backlog !== null && backlog.length === 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04] px-4 py-3 text-xs text-emerald-200/80">
          <CheckCircle2 className="size-4 shrink-0" />
          Nothing to split — every oversized file already has its chunk manifest.
        </div>
      )}

      {backlog !== null && backlog.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-white/[0.06]">
          <table className="w-full text-left text-xs">
            <thead className="bg-white/[0.03] text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Document</th>
                <th className="px-4 py-2.5 font-semibold">Size</th>
                <th className="px-4 py-2.5 font-semibold">Pages</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {backlog.map((item) => (
                <tr key={item._id} className="border-t border-white/[0.04]">
                  <td className="max-w-[320px] truncate px-4 py-3 text-foreground/90">
                    <span className="inline-flex items-center gap-2">
                      <FileWarning className="size-3.5 shrink-0 text-amber-400/70" />
                      {item.title}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">{mb(item.fileSizeBytes)}</td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">{item.pageCount ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    {done[item._id] ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-300/80">
                        <CheckCircle2 className="size-3.5" /> {done[item._id]}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void runSplit(item)}
                        disabled={runningId !== null}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        {runningId === item._id ? (
                          <>
                            <Loader2 className="size-3 animate-spin" /> Splitting… (can take minutes)
                          </>
                        ) : (
                          <>
                            <Scissors className="size-3" /> Split
                          </>
                        )}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {backlog === null && !loadingList && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
          <AlertTriangle className="size-3.5" /> Load the backlog to see oversized files without a chunk manifest.
        </div>
      )}
    </div>
  );
}
