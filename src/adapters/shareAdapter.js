// Web implementation of the share adapter. No feature in the app calls this
// yet -- it exists so the interface is in place before one does, and so a
// future native (Capacitor) adapter has a matching shape to implement.

export function createShareAdapter(documentAdapter) {
  return {
    canShare() {
      return typeof navigator.share === "function" && typeof navigator.canShare === "function";
    },

    async shareFile(name, bytes, type) {
      if (this.canShare()) {
        const file = new File([bytes], name, { type });
        if (navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file] });
            return true;
          } catch (e) {
            if (e && e.name === "AbortError") return false; // user cancelled the share sheet
            console.error("shareFile failed", e);
          }
        }
      }
      documentAdapter.downloadFile(name, bytes, type); // fall back to today's download behavior
      return false;
    },
  };
}
