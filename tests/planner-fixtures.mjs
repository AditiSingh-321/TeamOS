export const project = { id: "f6000000-0000-4000-8000-000000000010", workspace_id: "f6000000-0000-4000-8000-000000000020", name: "Store", description: "Build a store" };
export const input = { brief: "Build an e-commerce site with a shopping cart and checkout.", teamSize: 4, durationWeeks: 6, deadline: null, technologyStack: "Next.js, Supabase", instructions: "" };
export const plan = {
  projectSummary: "Build and verify the storefront.",
  tasks: [
    { tempId: "catalog", title: "Implement the product catalog", description: "Build a paginated catalog.", priority: "high", estimatedDays: 2, suggestedRole: "Frontend engineer", acceptanceCriteria: ["Products are visible with prices."], dependsOn: [] },
    { tempId: "checkout", title: "Implement checkout", description: "Build the checkout flow.", priority: "medium", estimatedDays: 3, suggestedRole: "Full-stack engineer", acceptanceCriteria: ["A test payment succeeds."], dependsOn: ["catalog"] },
  ],
};
