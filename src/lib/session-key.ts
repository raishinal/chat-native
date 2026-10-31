/** SecureStore accepts letters, digits, periods, hyphens and underscores. */
export function sessionStorageKey(apiOrigin: string): string {
  const identity = new URL(apiOrigin).origin;
  const encoded = Array.from(identity, (character) =>
    character.charCodeAt(0).toString(16).padStart(2, "0"),
  ).join("");
  return `relay.session.${encoded}`;
}
