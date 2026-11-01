export function safeInteractionErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error) || error.constructor !== Error) {
    return null;
  }

  const message = error.message.trim();
  return message.length > 0 && message.length <= 1_500 ? message : null;
}
