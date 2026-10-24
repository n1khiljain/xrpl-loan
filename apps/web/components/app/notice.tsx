import { AlertTriangle, Info } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function ErrorNotice({ title = "That didn't work", children }: { title?: string; children: ReactNode }) {
  return (
    <Alert variant="destructive" role="alert">
      <AlertTriangle />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

export function InfoNotice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Alert>
      <Info />
      <AlertTitle>{title}</AlertTitle>
      {children ? <AlertDescription>{children}</AlertDescription> : null}
    </Alert>
  );
}
