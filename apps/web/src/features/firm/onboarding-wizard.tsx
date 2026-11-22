"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { cn } from "cn";
import type { FirmProfile, FirmSettings } from "@ca-firm/shared-types";
import { FormErrorAlert } from "@/components/forms/form-error-alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { applyServerErrors } from "@/lib/form-errors";
import {
  FIRM_FIELDS,
  MONTH_FIELD,
  OWNER_ONLY_MESSAGE,
  diffFirmProfile,
  firmFormResolver,
  hasFieldErrorFor,
  hasKeys,
  isForbiddenError,
  toFormValues,
  type FirmFormValues,
} from "./firm-form";
import { FinancialYearField, FirmProfileFields } from "./firm-profile-fields";
import { FirmFormSkeleton, FirmLoadError } from "./firm-states";
import { useFirmData, useFirmMutations } from "./use-firm";

const STEPS = ["Firm details", "Financial year"] as const;

/** Owner-only first-run setup. The route guard (RequireAuth) decides who is allowed to see it. */
export function OnboardingWizard() {
  const { profile, settings, isPending, isFetching, error, refetch } = useFirmData();

  if (isPending) return <FirmFormSkeleton />;
  if (!profile || !settings) {
    return <FirmLoadError error={error} onRetry={refetch} retrying={isFetching} />;
  }
  return <OnboardingForm profile={profile} settings={settings} />;
}

function OnboardingForm({
  profile,
  settings,
}: {
  profile: FirmProfile;
  settings: FirmSettings;
}) {
  const router = useRouter();
  const { updateFirm, updateSettings } = useFirmMutations();
  const [step, setStep] = useState<0 | 1>(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [detailsSaved, setDetailsSaved] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FirmFormValues>({
    resolver: firmFormResolver,
    defaultValues: toFormValues(profile, settings),
  });

  // Move focus to the new step's heading so keyboard and screen-reader users land in context.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  async function finish(values: FirmFormValues) {
    setFormError(null);
    setSubmitting(true);

    // 1. Firm details: one PATCH with only what changed. `profile` is the last saved copy
    //    (the mutation writes its answer to the cache), so a retry after a later failure
    //    never re-sends details that already went through.
    const patch = diffFirmProfile(profile, values);
    let savedNow = detailsSaved;
    if (hasKeys(patch)) {
      try {
        await updateFirm.mutateAsync(patch);
        savedNow = true;
        setDetailsSaved(true);
      } catch (error) {
        setSubmitting(false);
        if (isForbiddenError(error)) {
          setFormError(OWNER_ONLY_MESSAGE);
          return;
        }
        if (hasFieldErrorFor(error, FIRM_FIELDS)) setStep(0);
        setFormError(applyServerErrors(error, setError, FIRM_FIELDS));
        return;
      }
    }

    // 2. Settings: financial-year month and the completion flag (idempotent, safe to retry).
    try {
      await updateSettings.mutateAsync({
        financial_year_start_month: Number(values.financial_year_start_month),
        onboarding_completed: true,
      });
    } catch (error) {
      setSubmitting(false);
      if (isForbiddenError(error)) {
        setFormError(OWNER_ONLY_MESSAGE);
        return;
      }
      const prefix = savedNow
        ? "Your firm details were saved, but setup is not finished yet. "
        : "";
      const message = applyServerErrors(error, setError, [MONTH_FIELD]);
      setFormError(message ? `${prefix}${message}` : null);
      return;
    }

    router.replace("/dashboard");
  }

  const onSubmit = handleSubmit((values) => {
    if (step === 0) {
      setFormError(null);
      setStep(1);
      return;
    }
    return finish(values);
  });

  return (
    <Card>
      <CardHeader>
        <ol aria-label="Setup progress" className="mb-2 flex flex-wrap gap-2 text-xs">
          {STEPS.map((label, i) => (
            <li
              key={label}
              aria-current={i === step ? "step" : undefined}
              className={cn(
                "rounded-full border px-2.5 py-0.5",
                i === step
                  ? "bg-primary text-primary-foreground border-primary"
                  : "text-muted-foreground",
              )}
            >
              Step {i + 1} of {STEPS.length}: {label}
            </li>
          ))}
        </ol>
        <CardTitle>
          <h1 ref={headingRef} tabIndex={-1} className="text-lg outline-none">
            {step === 0 ? "Set up your firm" : "Financial year and next steps"}
          </h1>
        </CardTitle>
        <CardDescription>
          {step === 0
            ? "Confirm your firm's details. You can change them later in Settings."
            : "One last choice, then your workspace is ready."}
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate aria-label="Firm setup">
        <CardContent className="flex flex-col gap-4">
          {/* Both steps stay mounted so values persist; the inactive one is hidden from everyone. */}
          <div hidden={step !== 0} className="flex flex-col gap-4">
            <FirmProfileFields
              register={register}
              errors={errors}
              currentTimezone={profile.timezone}
            />
          </div>
          <div hidden={step !== 1} className="flex flex-col gap-4">
            <FinancialYearField register={register} errors={errors} />
            <div className="bg-muted/50 rounded-lg p-3 text-sm">
              <h2 className="font-medium">What happens next</h2>
              <ul className="text-muted-foreground mt-1 list-disc space-y-1 pl-5">
                <li>Your firm profile and financial year are saved.</li>
                <li>You land on your dashboard and can invite your team.</li>
                <li>Everything here can be edited later in Settings.</li>
              </ul>
            </div>
          </div>
          <FormErrorAlert message={formError} />
        </CardContent>
        <CardFooter className="mt-4 justify-between gap-2">
          {step === 1 ? (
            <Button
              key="back"
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => {
                setFormError(null);
                setStep(0);
              }}
            >
              Back
            </Button>
          ) : (
            <span />
          )}
          {step === 0 ? (
            <Button key="continue" type="submit">
              Continue
            </Button>
          ) : (
            <Button key="finish" type="submit" disabled={submitting}>
              {submitting ? "Finishing setup…" : "Finish setup"}
            </Button>
          )}
        </CardFooter>
      </form>
    </Card>
  );
}
