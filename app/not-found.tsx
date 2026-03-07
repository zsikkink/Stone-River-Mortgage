export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-3xl flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Page not found
      </h1>
      <p className="mt-3 text-sm text-slate-600">
        The page you are looking for does not exist.
      </p>
    </main>
  );
}
