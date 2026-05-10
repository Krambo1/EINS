export default function RootNotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-brand-bg p-6 text-center">
      <h1>Seite nicht gefunden</h1>
      <p className="mt-3 text-brand-fg-muted">
        Die angeforderte Seite existiert nicht.
      </p>
    </main>
  );
}
