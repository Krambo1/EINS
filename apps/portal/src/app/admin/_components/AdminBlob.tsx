/**
 * Decorative mint blob anchored top-right of the viewport.
 * Subtler than the marketing site's twin blobs — admin pages have
 * dense tables and don't want full-viewport ambient gradients
 * competing with the data.
 */
export function AdminBlob() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div className="absolute -right-40 -top-40 transform-gpu blur-3xl">
        <div
          style={{
            clipPath:
              "polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)",
            background: "linear-gradient(to top right, #58BAB5, #64CEC9)",
          }}
          className="aspect-[1155/678] w-[40rem] rotate-[30deg] opacity-20"
        />
      </div>
    </div>
  );
}
