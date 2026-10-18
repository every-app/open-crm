import { createContext, use, useEffect, useRef, type ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/client/components/ui/button";

// Rows that reorder by dragging their handle, as the CRM's fields and their
// options do, or with the arrow keys on a focused handle. dnd-kit's own
// keyboard sensor listens on the document, which the sheets these lists sit
// in keep arrow keys from reaching (and Escape closes), so the handle takes
// its keys itself.

/** Moves a row one place up (-1) or down (1); false when it can't go. */
const MoveContext = createContext<(id: string, by: -1 | 1) => boolean>(
  () => false,
);

/** A list of SortableItems; `onReorder` gets their ids in the new order. */
export function SortableList({
  ids,
  onReorder,
  children,
}: {
  ids: string[];
  onReorder: (ids: string[]) => void;
  children: ReactNode;
}) {
  // A click on the handle isn't a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const reorder = (from: number, to: number) => {
    if (from === -1 || to < 0 || to >= ids.length || from === to) return false;
    onReorder(arrayMove(ids, from, to));
    return true;
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over)
      reorder(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
  };
  const move = (id: string, by: -1 | 1) => {
    const from = ids.indexOf(id);
    return reorder(from, from + by);
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <MoveContext value={move}>{children}</MoveContext>
      </SortableContext>
    </DndContext>
  );
}

/** One row of a SortableList: its drag handle, then `children`. */
export function SortableItem({
  id,
  label,
  className,
  children,
}: {
  id: string;
  /** What the handle reorders, for screen readers: "Reorder Tier". */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const move = use(MoveContext);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    index,
  } = useSortable({ id });
  // A row moved by the keyboard keeps its handle focused once it lands in
  // its new place: moving it in the page can take the focus away.
  const handle = useRef<HTMLButtonElement | null>(null);
  const landing = useRef<number | null>(null);
  useEffect(() => {
    if (landing.current !== index) return;
    landing.current = null;
    handle.current?.focus();
  }, [index]);
  // dnd-kit's instructions describe its keyboard sensor, which isn't used.
  const { "aria-describedby": _instructions, ...handleAttributes } = attributes;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-1",
        isDragging && "relative z-10 bg-background",
        className,
      )}
    >
      <Button
        ref={(node: HTMLButtonElement | null) => {
          handle.current = node;
          setActivatorNodeRef(node);
        }}
        variant="ghost"
        size="icon-xs"
        className="cursor-grab touch-none text-muted-foreground"
        {...handleAttributes}
        {...listeners}
        aria-label={`Reorder ${label}`}
        aria-keyshortcuts="ArrowUp ArrowDown"
        onKeyDown={(event) => {
          const by =
            event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
          if (by === 0) return;
          event.preventDefault();
          landing.current = index + by;
          if (!move(id, by)) landing.current = null;
        }}
      >
        <GripVertical />
      </Button>
      {children}
    </li>
  );
}
