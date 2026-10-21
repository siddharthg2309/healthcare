import type { FoodPhotoRecognitionRequest } from "@healthcare/contracts";

export async function prepareImage(file: File): Promise<FoodPhotoRecognitionRequest> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > 20_000_000) throw new Error("Choose a photo smaller than 20 MB.");

  const bitmap = await createImageBitmap(file);
  try {
    let maxEdge = 1440;
    let quality = 0.82;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser could not prepare the photo.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      const compressed = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", quality);
      });
      if (!compressed) throw new Error("This browser could not prepare the photo.");
      if (compressed.size <= 2_500_000) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => typeof reader.result === "string"
            ? resolve(reader.result)
            : reject(new Error("This browser could not read the photo."));
          reader.onerror = () => reject(new Error("This browser could not read the photo."));
          reader.readAsDataURL(compressed);
        });
        return { mimeType: "image/jpeg", base64: dataUrl.slice(dataUrl.indexOf(",") + 1) };
      }
      maxEdge = Math.round(maxEdge * 0.78);
      quality = Math.max(0.5, quality - 0.1);
    }
  } finally {
    bitmap.close();
  }
  throw new Error("The photo is still too large after compression. Choose another photo.");
}
