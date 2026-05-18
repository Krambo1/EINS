"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import Cropper, { type Area } from "react-easy-crop";
import {
  Avatar,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@eins/ui";
import { Camera, Trash2 } from "lucide-react";
import {
  uploadOwnAvatarAction,
  removeOwnAvatarAction,
} from "../avatar-actions";

interface Props {
  currentUrl: string | null;
  name: string | null;
  email: string;
}

/** Output size of the encoded avatar — 2x of the largest display (xl=80px). */
const OUTPUT_SIZE = 512;
/** Max megapixels accepted from the picker before complaining. Plenty for any
 *  modern phone photo, but rejects, say, a 50 MP RAW dump that would crash the
 *  decoder. */
const MAX_INPUT_MP = 25;
/** Cap on the chosen file size before we even try to decode it. */
const MAX_INPUT_BYTES = 12 * 1024 * 1024;

export function AvatarUploader({ currentUrl, name, email }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pickedSrc, setPickedSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, startUpload] = useTransition();
  const [isRemoving, startRemove] = useTransition();

  const onPick = () => fileInputRef.current?.click();

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    // Reset the input so picking the same file twice in a row re-triggers.
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_INPUT_BYTES) {
      setError("Datei zu groß (max. 12 MB). Bitte ein kleineres Bild wählen.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("Bitte eine Bilddatei auswählen.");
      return;
    }

    const url = URL.createObjectURL(file);
    setPickedSrc(url);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedArea(null);
  };

  const onCropComplete = useCallback((_: Area, areaPixels: Area) => {
    setCroppedArea(areaPixels);
  }, []);

  const closeDialog = () => {
    if (pickedSrc) URL.revokeObjectURL(pickedSrc);
    setPickedSrc(null);
    setCroppedArea(null);
  };

  const onSave = () => {
    if (!pickedSrc || !croppedArea) return;
    startUpload(async () => {
      try {
        const blob = await renderCroppedBlob(pickedSrc, croppedArea);
        const fd = new FormData();
        fd.append("avatar", new File([blob], "avatar.webp", { type: blob.type }));
        await uploadOwnAvatarAction(fd);
        closeDialog();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Hochladen fehlgeschlagen.");
      }
    });
  };

  const onRemove = () => {
    startRemove(async () => {
      try {
        await removeOwnAvatarAction();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Entfernen fehlgeschlagen.");
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Avatar src={currentUrl} name={name ?? email} size="xl" />

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onPick}
          disabled={isUploading || isRemoving}
        >
          <Camera className="h-4 w-4" />
          {currentUrl ? "Bild ändern" : "Bild hochladen"}
        </Button>
        {currentUrl && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRemove}
            disabled={isUploading || isRemoving}
          >
            <Trash2 className="h-4 w-4" />
            {isRemoving ? "Wird entfernt …" : "Entfernen"}
          </Button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
        className="sr-only"
        onChange={onFileChange}
      />

      {error && !pickedSrc && (
        <p className="basis-full text-sm text-tone-bad" role="alert">
          {error}
        </p>
      )}

      <Dialog
        open={pickedSrc !== null}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Profilbild zuschneiden</DialogTitle>
            <DialogDescription>
              Ziehen und zoomen Sie, bis Ihr Gesicht mittig im Kreis sitzt.
            </DialogDescription>
          </DialogHeader>

          <div className="relative h-72 w-full overflow-hidden rounded-xl bg-bg-secondary">
            {pickedSrc && (
              <Cropper
                image={pickedSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            )}
          </div>

          <div className="flex items-center gap-3">
            <label className="text-sm text-fg-secondary" htmlFor="zoom">
              Zoom
            </label>
            <input
              id="zoom"
              type="range"
              min={1}
              max={4}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1 accent-fg-primary"
            />
          </div>

          {error && (
            <p className="text-sm text-tone-bad" role="alert">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeDialog}
              disabled={isUploading}
            >
              Abbrechen
            </Button>
            <Button
              type="button"
              onClick={onSave}
              disabled={isUploading || !croppedArea}
            >
              {isUploading ? "Wird hochgeladen …" : "Speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Render the cropped region to a 512×512 WebP blob via canvas. Falls back to
 * JPEG when WebP isn't supported (older Safari). Rejects images whose decoded
 * pixel count is implausible (defends against a maliciously large input).
 */
async function renderCroppedBlob(
  imageSrc: string,
  area: Area
): Promise<Blob> {
  const img = await loadImage(imageSrc);
  const mp = (img.naturalWidth * img.naturalHeight) / 1_000_000;
  if (mp > MAX_INPUT_MP) {
    throw new Error("Bildauflösung zu hoch. Bitte ein kleineres Bild wählen.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas-Kontext nicht verfügbar.");

  ctx.drawImage(
    img,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    OUTPUT_SIZE,
    OUTPUT_SIZE
  );

  const webpBlob = await canvasToBlob(canvas, "image/webp", 0.9);
  if (webpBlob && webpBlob.type === "image/webp" && webpBlob.size > 0) {
    return webpBlob;
  }
  const jpegBlob = await canvasToBlob(canvas, "image/jpeg", 0.9);
  if (jpegBlob && jpegBlob.size > 0) return jpegBlob;
  throw new Error("Bild konnte nicht kodiert werden.");
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Bild konnte nicht geladen werden."));
    img.src = src;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}
