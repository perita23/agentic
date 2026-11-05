import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonCard, SkeletonText } from "@/components/app/skeletons";

export default function Loading() {
  return (
    <div className="flex flex-col gap-5" role="status" aria-label="Cargando">
      <Skeleton className="h-4 w-24" />
      <div className="grid gap-2">
        <Skeleton className="h-7 w-2/5" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-5 w-56" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="rounded-lg border bg-card p-4">
          <SkeletonText lines={5} />
          <Skeleton className="my-4 h-16 w-full rounded-lg" />
          <SkeletonText lines={3} />
        </div>
        <div className="grid content-start gap-4">
          <SkeletonCard rows={2} />
          <SkeletonCard rows={2} />
        </div>
      </div>
    </div>
  );
}
