import type { FileSlice } from "../../../src/shared/panelContract";
import { EMPTY_FILE_VIEW, FileView, fileViewOf } from "../../../src/shared/panelFileView";

export type { FileView };

// A slice is read by several components on every render, and the models must be the same objects each time
const views = new WeakMap<FileSlice, FileView>();

/** What the panel shows of the file, see `FileView`. Before the host has sent a `file` slice there is nothing */
export function fileView(file: FileSlice | undefined): FileView {
  if (!file) {
    return EMPTY_FILE_VIEW;
  }
  let view = views.get(file);
  if (!view) {
    view = fileViewOf(file);
    views.set(file, view);
  }
  return view;
}
