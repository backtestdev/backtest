import Link from "next/link";

export const dynamic = "force-dynamic";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-th-bg flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-5xl font-bold text-th-text tracking-tight">404</h1>
        <p className="mt-3 text-lg text-th-text-3">Page not found.</p>
        <Link
          href="/"
          className="inline-block mt-6 px-6 py-2.5 text-sm font-medium text-white bg-th-accent rounded-xl hover:bg-th-accent-hover transition-colors"
        >
          Back to SoloQuant
        </Link>
      </div>
    </div>
  );
}
