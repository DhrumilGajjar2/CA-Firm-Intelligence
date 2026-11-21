import type { Metadata } from "next";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = { title: "Reset your password" };

export default function Page() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>Password reset is built in P1.</CardDescription>
      </CardHeader>
      <CardContent>
        <Link href="/login" className="text-primary text-sm hover:underline">
          Back to sign in
        </Link>
      </CardContent>
    </Card>
  );
}
