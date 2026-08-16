import { api } from "@/convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  BookOpen,
  CalendarDays,
  ClipboardList,
  Download,
  FileSearch,
  GraduationCap,
  Loader2,
  Presentation,
  RotateCcw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CONTENT_TYPES,
  CONTENT_TYPE_LABELS,
  type ContentType,
} from "@/convex/constants";
import type { ContentItemWithSubject } from "@/convex/content";

const TYPE_STYLES: Record<
  ContentType,
  { icon: typeof BookOpen; classes: string }
> = {
  textbook: { icon: BookOpen, classes: "bg-indigo-400/10 text-indigo-300" },
  past_exam: { icon: CalendarDays, classes: "bg-sky-400/10 text-sky-300" },
  worksheet: { icon: ClipboardList, classes: "bg-violet-400/10 text-violet-300" },
  student_guide: { icon: GraduationCap, classes: "bg-teal-400/10 text-teal-300" },
  teacher_guide: { icon: Presentation, classes: "bg-amber-400/10 text-amber-300" },
};

function formatBytes(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ContentCard({
  item,
  onOpen,
  opening,
}: {
  item: ContentItemWithSubject;
  onOpen: (item: ContentItemWithSubject) => void;
  opening: boolean;
}) {
  const style = TYPE_STYLES[item.contentType];
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="glass-panel group flex flex-col rounded-2xl p-5 transition-transform duration-300 hover:-translate-y-1"
    >
      <div className="flex items-start justify-between gap-2">
        <div className={`flex size-11 items-center justify-center rounded-xl ${style.classes}`}>
          <style.icon className="size-5" />
        </div>
        {item.isPremium && (
          <Badge className="gap-1 bg-amber-400/10 text-amber-300">
            <Sparkles className="size-3" /> Premium
          </Badge>
        )}
      </div>

      <h3 className="mt-4 line-clamp-2 text-sm font-bold leading-snug tracking-tight">
        {item.title}
      </h3>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
        <span className="glass-chip rounded-md px-2 py-0.5 text-muted-foreground">
          {item.subjectName}
        </span>
        <span className="glass-chip rounded-md px-2 py-0.5 text-muted-foreground">
          Grade {item.grade}
        </span>
        {item.examYear ? (
          <span className="glass-chip rounded-md px-2 py-0.5 text-muted-foreground">
            {item.examYear}
          </span>
        ) : null}
      </div>

      <div className="mt-3 text-[11px] text-muted-foreground">
        {formatBytes(item.fileSizeBytes)}
        {item.pageCount ? ` · ${item.pageCount} pages` : ""}
      </div>

      <Button
        size="sm"
        variant="outline"
        className="mt-4 w-full cursor-pointer rounded-xl bg-white/5"
        onClick={() => onOpen(item)}
        disabled={opening}
      >
        {opening ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Download className="size-3.5" />
        )}
        {item.isPremium ? "Open signed copy" : "Open"}
      </Button>
    </motion.div>
  );
}

export default function Dashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [grade, setGrade] = useState("");
  const [subjectSlug, setSubjectSlug] = useState("");
  const [contentType, setContentType] = useState("");
  const [examYear, setExamYear] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);

  const subjects = useQuery(api.subjects.getAll);
  const isAdmin = useQuery(api.admin.isCurrentUserAdmin);
  const getDownloadUrl = useAction(api.contentAdmin.getDownloadUrl);

  const content = useQuery(api.content.getContent, {
    grade: grade ? Number(grade) : undefined,
    subjectSlug: subjectSlug || undefined,
    contentType: (contentType || undefined) as ContentType | undefined,
    examYear: examYear ? Number(examYear) : undefined,
    searchQuery: searchQuery.trim() || undefined,
  });

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: current - 2002 }, (_, i) => current - i);
  }, []);

  const hasFilters =
    searchQuery.trim() !== "" ||
    grade !== "" ||
    subjectSlug !== "" ||
    contentType !== "" ||
    examYear !== "";

  const handleOpen = async (item: ContentItemWithSubject) => {
    if (!item.isPremium) {
      window.open(item.fileUrl, "_blank", "noopener,noreferrer");
      return;
    }
    setOpeningId(item._id);
    try {
      const { url } = await getDownloadUrl({ contentId: item._id });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not generate a download link.",
      );
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <DashboardShell>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
              National exam prep
            </p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
              The Library
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Textbooks, past exams, worksheets and guides for grades 9–12.
            </p>
          </div>
          {isAdmin && (
            <Button asChild variant="outline" size="sm" className="rounded-xl bg-white/5">
              <Link to="/admin/content-upload">
                <Sparkles className="size-4" /> Upload content
              </Link>
            </Button>
          )}
        </div>

        {/* Search + filters */}
        <div className="glass-panel rounded-2xl p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search titles and subjects — e.g. “physics past exam”"
              className="h-10 rounded-xl bg-white/5 pl-9 pr-9 font-mono text-sm"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground">Grade</span>
            <Select value={grade} onValueChange={(v) => setGrade(v === "all" ? "" : v)}>
              <SelectTrigger className="h-9 rounded-xl bg-white/5">
                <SelectValue placeholder="All grades" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All grades</SelectItem>
                {[9, 10, 11, 12].map((g) => (
                  <SelectItem key={g} value={String(g)}>
                    Grade {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground">Subject</span>
            <Select value={subjectSlug} onValueChange={(v) => setSubjectSlug(v === "all" ? "" : v)}>
              <SelectTrigger className="h-9 rounded-xl bg-white/5">
                <SelectValue placeholder="All subjects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All subjects</SelectItem>
                {subjects?.map((subject) => (
                  <SelectItem key={subject._id} value={subject.slug}>
                    {subject.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground">Type</span>
            <Select value={contentType} onValueChange={(v) => setContentType(v === "all" ? "" : v)}>
              <SelectTrigger className="h-9 rounded-xl bg-white/5">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {CONTENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {CONTENT_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground">
              Exam year {contentType && contentType !== "past_exam" ? "· n/a" : ""}
            </span>
            {contentType === "" || contentType === "past_exam" ? (
              <Select value={examYear} onValueChange={(v) => setExamYear(v === "any" ? "" : v)} disabled={contentType === ""}>
                <SelectTrigger className="h-9 rounded-xl bg-white/5">
                  <SelectValue placeholder={contentType === "" ? "Pick Past Exams first" : "Any year"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any year</SelectItem>
                  {yearOptions.map((year) => (
                    <SelectItem key={year} value={String(year)}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex h-9 items-center rounded-xl border border-dashed border-border bg-white/5 px-3 text-xs text-muted-foreground">
                Only for past exams
              </div>
            )}
          </div>
          </div>
        </div>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="w-fit cursor-pointer rounded-xl text-muted-foreground"
            onClick={() => {
              setSearchQuery("");
              setGrade("");
              setSubjectSlug("");
              setContentType("");
              setExamYear("");
            }}
          >
            <RotateCcw className="size-3.5" /> Reset filters
          </Button>
        )}

        {/* Content */}
        {content === undefined ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : content.length === 0 ? (
          <div className="glass-soft flex flex-col items-center justify-center rounded-2xl px-6 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <FileSearch className="size-6" />
            </div>
            <h3 className="mt-4 font-bold tracking-tight">No content here yet</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {hasFilters
                ? "Nothing matches those filters. Try widening your search."
                : "The library is being stocked. Check back soon, or ask an admin to upload content."}
            </p>
            {isAdmin && !hasFilters && (
              <Button asChild size="sm" className="mt-5 rounded-xl">
                <Link to="/admin/content-upload">
                  <Sparkles className="size-4" /> Upload the first item
                </Link>
              </Button>
            )}
          </div>
        ) : (
          <motion.div layout className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {content.map((item) => (
              <ContentCard
                key={item._id}
                item={item}
                onOpen={handleOpen}
                opening={openingId === item._id}
              />
            ))}
          </motion.div>
        )}
      </div>
    </DashboardShell>
  );
}
