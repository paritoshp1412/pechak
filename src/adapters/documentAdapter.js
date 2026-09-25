// Web implementation of the document adapter: file picking/reading via
// <input type=file>/FileReader, and file saving via Blob + object URL.
// A future native (Capacitor) adapter implements the same method names
// against the Android system document picker instead.

export function createDocumentAdapter() {
  return {
    pickFile(accept) {
      return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        if (accept) input.accept = accept;
        input.style.display = "none";
        input.onchange = () => {
          resolve(input.files[0] || null);
          input.remove();
        };
        document.body.appendChild(input);
        input.click();
      });
    },

    readAsArrayBuffer(file) {
      return new Promise((resolve, reject) => {
        const rd = new FileReader();
        rd.onload = (ev) => resolve(ev.target.result);
        rd.onerror = () => reject(rd.error);
        rd.readAsArrayBuffer(file);
      });
    },

    readAsText(file) {
      return new Promise((resolve, reject) => {
        const rd = new FileReader();
        rd.onload = (ev) => resolve(ev.target.result);
        rd.onerror = () => reject(rd.error);
        rd.readAsText(file);
      });
    },

    downloadFile(name, bytes, type) {
      const blob = new Blob([bytes], { type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 400);
    },

    async fetchBundledAsset(path) {
      const res = await fetch(path);
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
