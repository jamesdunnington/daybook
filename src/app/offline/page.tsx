export default function OfflinePage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4 text-center">
      <div>
        <h1 className="text-2xl font-bold mb-2">You are offline</h1>
        <p className="text-muted-foreground">
          Check your internet connection and try again.
        </p>
      </div>
    </div>
  );
}
