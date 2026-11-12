import { Directive, EventEmitter, HostBinding, HostListener, Output } from '@angular/core';

/**
 * Drag-and-drop target for file upload. Emits the first dropped file and
 * toggles a `drag-over` class so the host can highlight itself. Only the
 * first file is taken — the API ingests one document per upload.
 */
@Directive({
  selector: '[appDropZone]',
  standalone: true,
})
export class DropZoneDirective {
  @Output() readonly fileDropped = new EventEmitter<File>();

  @HostBinding('class.drag-over') isDragOver = false;

  @HostListener('dragover', ['$event'])
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver = true;
  }

  @HostListener('dragleave', ['$event'])
  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver = false;
  }

  @HostListener('drop', ['$event'])
  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      this.fileDropped.emit(file);
    }
  }
}
