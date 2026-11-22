import type { FieldErrors, UseFormRegister } from "react-hook-form";
import { FormField, fieldProps } from "@/components/forms/form-field";
import { SelectInput, TextareaInput } from "@/components/forms/native-controls";
import { Input } from "@/components/ui/input";
import { MONTH_OPTIONS, timezoneOptionsFor, type FirmFormValues } from "./firm-form";

interface FieldsProps {
  register: UseFormRegister<FirmFormValues>;
  errors: FieldErrors<FirmFormValues>;
  disabled?: boolean;
}

const Optional = () => <span className="text-muted-foreground text-xs">Optional</span>;

/** Firm name, address, contact email, phone and timezone (shared by onboarding and settings). */
export function FirmProfileFields({
  register,
  errors,
  disabled,
  currentTimezone,
}: FieldsProps & { currentTimezone: string }) {
  return (
    <>
      <FormField id="name" label="Firm name" error={errors.name?.message}>
        <Input
          {...fieldProps("name", errors.name?.message)}
          autoComplete="organization"
          disabled={disabled}
          {...register("name")}
        />
      </FormField>
      <FormField
        id="address"
        label="Address"
        labelAside={<Optional />}
        error={errors.address?.message}
      >
        <TextareaInput
          {...fieldProps("address", errors.address?.message)}
          rows={3}
          autoComplete="street-address"
          disabled={disabled}
          {...register("address")}
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="email"
          label="Contact email"
          labelAside={<Optional />}
          error={errors.email?.message}
        >
          <Input
            {...fieldProps("email", errors.email?.message)}
            type="email"
            autoComplete="email"
            disabled={disabled}
            {...register("email")}
          />
        </FormField>
        <FormField
          id="phone"
          label="Phone"
          labelAside={<Optional />}
          error={errors.phone?.message}
        >
          <Input
            {...fieldProps("phone", errors.phone?.message)}
            type="tel"
            autoComplete="tel"
            disabled={disabled}
            {...register("phone")}
          />
        </FormField>
      </div>
      <FormField id="timezone" label="Timezone" error={errors.timezone?.message}>
        <SelectInput
          {...fieldProps("timezone", errors.timezone?.message)}
          disabled={disabled}
          {...register("timezone")}
        >
          {timezoneOptionsFor(currentTimezone).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectInput>
      </FormField>
    </>
  );
}

/** Financial-year start month select. */
export function FinancialYearField({ register, errors, disabled }: FieldsProps) {
  const error = errors.financial_year_start_month?.message;
  return (
    <FormField
      id="financial_year_start_month"
      label="Financial year starts in"
      error={error}
      hint={
        <p className="text-muted-foreground text-xs">
          Indian firms usually start in April (1 April to 31 March).
        </p>
      }
    >
      <SelectInput
        {...fieldProps("financial_year_start_month", error)}
        disabled={disabled}
        {...register("financial_year_start_month")}
      >
        {MONTH_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </SelectInput>
    </FormField>
  );
}
