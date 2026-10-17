function getFormError(error: unknown): string | null {
  if (typeof error === "string") {
    return error;
  }

  if (
    error &&
    typeof error === "object" &&
    "form" in error &&
    typeof error.form === "string"
  ) {
    return error.form;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return null;
}

export function getFieldError(errors: readonly unknown[]) {
  return getFormError(errors[0]);
}
