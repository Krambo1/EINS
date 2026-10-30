"use client";

import { useFormStatus } from "react-dom";
import { Trash2 } from "lucide-react";
import { Button, cn } from "@eins/ui";
import { CONTROL, CONTROL_SQUARE, RAISED_CONTROL } from "../../dashboard/_components/dash-ui";
import { showActionFlash } from "../../_components/flash-event";
import { deleteClientUploadAction } from "../actions";
import { useFileList } from "./FileList";

/**
 * Deletes one sent file with one tap, no question first (Karam: one tap
 * saves). The row leaves the list on the tap (FileListState `hide`); the
 * toast names the file afterwards. If the server keeps the file, the
 * revalidated list brings the row back with the error toast; without a
 * connection the row comes back with a toast from here.
 */
export function DeleteFileButton({ id, filename }: { id: string; filename: string }) {
  const list = useFileList();
  return (
    <form
      action={async (fd) => {
        list?.hide(id);
        try {
          await deleteClientUploadAction(fd);
        } catch {
          showActionFlash({
            tone: "bad",
            title: "Datei nicht gelöscht",
            description: `${filename}: Keine Verbindung. Bitte versuchen Sie es noch einmal.`,
          });
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <DeleteSubmit filename={filename} />
    </form>
  );
}

function DeleteSubmit({ filename }: { filename: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="outline"
      disabled={pending}
      aria-busy={pending || undefined}
      aria-label={`Löschen: ${filename}`}
      title="Löschen"
      className={cn(
        RAISED_CONTROL,
        CONTROL,
        CONTROL_SQUARE,
        "text-fg-secondary hover:text-tone-bad disabled:opacity-50"
      )}
    >
      <Trash2 className="h-4 w-4" aria-hidden />
    </Button>
  );
}
