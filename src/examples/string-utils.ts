/**
 * Small utility used to exercise the ai-resolve pipeline end-to-end (webhook/
 * workflow -> agent -> test suite -> PR). Not part of the resolver's own logic.
 */
export function capitalizeWords(input: string): string {
  return input
    .split(" ")
    .map((word) => word.toUpperCase())
    .join(" ");
}
