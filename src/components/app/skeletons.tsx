import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Lines of text: the last one shorter, like a paragraph. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("grid gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-3" style={{ width: i === lines - 1 && lines > 1 ? "62%" : `${92 - ((i * 7) % 18)}%` }} />
      ))}
    </div>
  );
}

/** A list row: a dot, two lines and a trailing label. */
export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3 px-4 py-3", className)}>
      <Skeleton className="size-2.5 shrink-0 rounded-full" />
      <div className="grid min-w-0 flex-1 gap-1.5">
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
      <Skeleton className="h-5 w-16 rounded-full" />
    </div>
  );
}

export function SkeletonRows({ n = 5, className }: { n?: number; className?: string }) {
  return (
    <div className={cn("divide-y", className)}>
      {Array.from({ length: n }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

export function SkeletonStat() {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="size-4 rounded" />
      </div>
      <Skeleton className="mt-3 h-7 w-16" />
      <Skeleton className="mt-2 h-3 w-28" />
    </div>
  );
}

export function SkeletonStats({ n = 4 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: n }, (_, i) => (
        <SkeletonStat key={i} />
      ))}
    </div>
  );
}

export function SkeletonCard({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-20" />
      </CardHeader>
      <CardContent className="px-0">
        <SkeletonRows n={rows} />
      </CardContent>
    </Card>
  );
}

export function SkeletonHeader() {
  return (
    <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="grid gap-2">
        <div className="flex items-center gap-2">
          <Skeleton className="size-5 rounded" />
          <Skeleton className="h-6 w-44" />
        </div>
        <Skeleton className="h-3.5 w-72 max-w-full" />
      </div>
      <Skeleton className="h-8 w-28" />
    </div>
  );
}

/** What most pages look like while they load: header, a row of figures and a list. */
export function PageSkeleton({ stats = 0, rows = 6, cards = 1 }: { stats?: number; rows?: number; cards?: number }) {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Cargando">
      <SkeletonHeader />
      {stats > 0 && <SkeletonStats n={stats} />}
      <div className={cn("grid gap-6", cards > 1 && "lg:grid-cols-2")}>
        {Array.from({ length: cards }, (_, i) => (
          <SkeletonCard key={i} rows={rows} />
        ))}
      </div>
    </div>
  );
}

/** A conversation while it loads: a message from you and a longer answer. */
export function SkeletonChat() {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-6" role="status" aria-label="Cargando">
      <div className="flex justify-end">
        <Skeleton className="h-10 w-2/5 rounded-2xl rounded-br-md" />
      </div>
      <div className="grid gap-2.5">
        <SkeletonText lines={4} />
        <Skeleton className="mt-1 h-14 w-full rounded-lg" />
        <SkeletonText lines={2} />
      </div>
    </div>
  );
}
