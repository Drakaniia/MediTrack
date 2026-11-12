import { Button } from "@cmis/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@cmis/ui/components/dialog";
import { Input } from "@cmis/ui/components/input";
import type { CategoryDto } from "@shared/schemas/inventory";
import { type FormEvent, type ReactElement, useState } from "react";
import { toast } from "sonner";

import { errorMessage } from "@/lib/api/errors";

import {
  useDeleteCategory,
  useSaveCategory,
} from "../hooks/inventory-mutations";
import { useCategories } from "../hooks/inventory-queries";
import { NativeSelect } from "./native-select";

const UNCATEGORISED = "none";

function AddCategoryForm(): ReactElement {
  const [name, setName] = useState("");
  const save = useSaveCategory();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === "") {
      return;
    }
    save.mutate(
      { name: name.trim() },
      {
        onError: (error) =>
          toast.error(errorMessage(error, "Could not add the category.")),
        onSuccess: () => setName(""),
      }
    );
  };

  return (
    <form className="flex gap-2" onSubmit={submit}>
      <Input
        aria-label="New category name"
        onChange={(event) => setName(event.target.value)}
        placeholder="New category"
        value={name}
      />
      <Button disabled={save.isPending} type="submit">
        Add
      </Button>
    </form>
  );
}

function CategoryRow({
  category,
  others,
}: {
  category: CategoryDto;
  others: readonly CategoryDto[];
}): ReactElement {
  const [mode, setMode] = useState<"delete" | "idle" | "rename">("idle");
  const [name, setName] = useState(category.name);
  const [target, setTarget] = useState(UNCATEGORISED);
  const save = useSaveCategory();
  const remove = useDeleteCategory();
  const itemCount = category.itemCount ?? 0;

  const rename = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(
      { id: category.id, name: name.trim() },
      {
        onError: (error) =>
          toast.error(errorMessage(error, "Could not rename.")),
        onSuccess: () => setMode("idle"),
      }
    );
  };

  const confirmDelete = () => {
    remove.mutate(
      {
        id: category.id,
        reassignTo: itemCount > 0 ? target : undefined,
      },
      {
        onError: (error) =>
          toast.error(errorMessage(error, "Could not delete.")),
        onSuccess: () => toast.success(`Deleted category "${category.name}".`),
      }
    );
  };

  if (mode === "rename") {
    return (
      <li>
        <form className="flex gap-2" onSubmit={rename}>
          <Input
            aria-label={`Rename ${category.name}`}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
          <Button disabled={save.isPending} type="submit">
            Save
          </Button>
          <Button onClick={() => setMode("idle")} variant="ghost">
            Cancel
          </Button>
        </form>
      </li>
    );
  }

  return (
    <li className="grid gap-2 py-1">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm">
          {category.name}{" "}
          <span className="text-muted-foreground text-xs">
            ({itemCount} {itemCount === 1 ? "item" : "items"})
          </span>
        </span>
        <span className="flex gap-1">
          <Button
            aria-label={`Rename ${category.name}`}
            onClick={() => setMode("rename")}
            size="sm"
            variant="ghost"
          >
            Rename
          </Button>
          <Button
            aria-label={`Delete ${category.name}`}
            onClick={() =>
              itemCount > 0 ? setMode("delete") : confirmDelete()
            }
            size="sm"
            variant="ghost"
          >
            Delete
          </Button>
        </span>
      </div>
      {mode === "delete" ? (
        <div className="flex items-end gap-2 rounded-md bg-muted p-2">
          <NativeSelect
            className="flex-1"
            label={`Move ${itemCount} item(s) to`}
            onChange={setTarget}
            options={[
              { label: "Uncategorised", value: UNCATEGORISED },
              ...others.map((other) => ({
                label: other.name,
                value: other.id,
              })),
            ]}
            value={target}
          />
          <Button
            disabled={remove.isPending}
            onClick={confirmDelete}
            variant="destructive"
          >
            Move and delete
          </Button>
          <Button onClick={() => setMode("idle")} variant="ghost">
            Cancel
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function CategoryDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}): ReactElement {
  const { data: categories = [] } = useCategories();
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Categories</DialogTitle>
          <DialogDescription>
            Group items so they are easier to find and filter.
          </DialogDescription>
        </DialogHeader>
        <AddCategoryForm />
        <ul className="max-h-80 divide-y overflow-auto">
          {categories.map((category) => (
            <CategoryRow
              category={category}
              key={category.id}
              others={categories.filter((other) => other.id !== category.id)}
            />
          ))}
        </ul>
        {categories.length === 0 ? (
          <p className="text-muted-foreground text-sm">No categories yet.</p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
