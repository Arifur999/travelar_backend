/// Cycled when a category is created without a colour, so the dashboard donut
/// always has distinct slices without anyone choosing one.
export const PRESET_CATEGORY_COLORS = [
  "#2563eb", "#16a34a", "#ea580c", "#dc2626", "#9333ea",
  "#0891b2", "#ca8a04", "#db2777", "#4f46e5", "#059669",
];

export const expenseSearchableFields = ["notes", "category.name", "cashAccount.name"];

export const expenseFilterableFields = ["categoryId", "cashAccountId", "amount", "date"];
