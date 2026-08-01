import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center px-4">
      <div className="text-center">
        <p className="text-7xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500">
          403
        </p>
        <h1 className="mt-4 text-2xl font-bold">Access Denied</h1>
        <p className="mt-2 text-sm text-gray-400">
          You do not have the required permission to view this page.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-block px-6 py-2.5 rounded-lg text-sm font-semibold text-white
                     bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-400 hover:to-cyan-500
                     shadow-[0_0_12px_rgba(6,182,212,0.3)] hover:shadow-[0_0_20px_rgba(6,182,212,0.5)]
                     transition-all duration-200"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
