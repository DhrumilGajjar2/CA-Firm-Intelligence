import { Alert, AlertDescription } from "@/components/ui/alert";

/** Non-field error (API failure, invalid credentials, ...). `role="alert"` is set by <Alert>. */
export function FormErrorAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
