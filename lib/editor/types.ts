export type EditMode = "select" | "prompt" | "render";
export type Variation = "conservative" | "balanced" | "creative";
export type Tool = "brush" | "erase" | "rect" | "lasso" | "pan";

export type Version = {
  id: string;
  parentId: string | null;
  label: string;
  instruction: string | null;
  mode: EditMode | null;
  url: string;
  createdAt: number;
};

export type VariantState = {
  id: Variation;
  label: string;
  status: "pending" | "ready" | "error";
  url: string | null;
  error: string | null;
};
