export const dynamic = "force-dynamic";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-50/50 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-5xl font-bold text-gray-900 tracking-tight">404</h1>
        <p className="mt-3 text-lg text-gray-400">Page not found.</p>
      </div>
    </div>
  );
}
