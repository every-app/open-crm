import {
  useId,
  type ChangeEvent,
  type ComponentProps,
  type ReactNode,
} from "react";
import { createFormHook } from "@tanstack/react-form";
import { cn } from "cn";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/client/components/ui/field";
import { Input } from "@/client/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/client/components/ui/input-group";
import { SettingsRow } from "@/client/components/SettingsSection";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Switch } from "@/client/components/ui/switch";
import { Textarea } from "@/client/components/ui/textarea";
import {
  fieldContext,
  formContext,
  useFieldContext,
  useFormContext,
} from "@/client/components/form/formContext";
import { getFieldError } from "@/client/lib/forms";

type FieldText = {
  label: ReactNode;
  /** The hint under the control. The control's aria-describedby points at it. */
  description?: ReactNode;
};

// Props the field components own. Everything else passes through to the control.
type BoundProps =
  | "id"
  | "name"
  | "value"
  | "onChange"
  | "onBlur"
  | "aria-invalid"
  | "aria-describedby";

/** One id, label, hint and error wiring for every field component. */
function useFieldControl(description: ReactNode) {
  const field = useFieldContext<unknown>();
  const id = useId();
  const error = getFieldError(field.state.meta.errors);
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ");
  const invalid = error ? true : undefined;

  return {
    invalid,
    messages: (
      <>
        {description ? (
          <FieldDescription id={descriptionId}>{description}</FieldDescription>
        ) : null}
        {error ? <FieldError id={errorId}>{error}</FieldError> : null}
      </>
    ),
    controlProps: {
      id,
      onBlur: field.handleBlur,
      "aria-invalid": invalid,
      "aria-describedby": describedBy || undefined,
    },
  };
}

function TextField({
  label,
  hideLabel = false,
  description,
  ...inputProps
}: FieldText & {
  /** Keeps the label for screen readers only, for forms that use placeholders. */
  hideLabel?: boolean;
} & Omit<ComponentProps<typeof Input>, BoundProps>) {
  const field = useFieldContext<string>();
  const control = useFieldControl(description);

  return (
    <Field data-invalid={control.invalid}>
      <FieldLabel
        htmlFor={control.controlProps.id}
        className={hideLabel ? "sr-only" : undefined}
      >
        {label}
      </FieldLabel>
      <Input
        {...inputProps}
        {...control.controlProps}
        name={field.name}
        value={field.state.value}
        onChange={(event) => field.handleChange(event.target.value)}
      />
      {control.messages}
    </Field>
  );
}

/**
 * A text field as one settings row: the label and hint on the left, the
 * input and its error on the right. Goes inside a `SettingsCard`.
 */
function RowTextField({
  label,
  description,
  prefix,
  className,
  ...inputProps
}: FieldText & {
  /** Fixed text before the value, such as "https://". */
  prefix?: string;
} & Omit<ComponentProps<typeof Input>, BoundProps>) {
  const field = useFieldContext<string>();
  const id = useId();
  const error = getFieldError(field.state.meta.errors);
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const props = {
    ...inputProps,
    id,
    name: field.name,
    value: field.state.value,
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      field.handleChange(event.target.value),
    onBlur: field.handleBlur,
    "aria-invalid": error ? true : undefined,
    "aria-describedby":
      [descriptionId, errorId].filter(Boolean).join(" ") || undefined,
  };

  return (
    <SettingsRow
      label={label}
      htmlFor={id}
      description={
        description ? <span id={descriptionId}>{description}</span> : undefined
      }
    >
      <div className={cn("flex w-full flex-col gap-1.5 sm:w-72", className)}>
        {prefix ? (
          <InputGroup>
            <InputGroupAddon>
              <InputGroupText>{prefix}</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput {...props} />
          </InputGroup>
        ) : (
          <Input {...props} />
        )}
        {error ? <FieldError id={errorId}>{error}</FieldError> : null}
      </div>
    </SettingsRow>
  );
}

function TextareaField({
  label,
  description,
  ...textareaProps
}: FieldText & Omit<ComponentProps<typeof Textarea>, BoundProps>) {
  const field = useFieldContext<string>();
  const control = useFieldControl(description);

  return (
    <Field data-invalid={control.invalid}>
      <FieldLabel htmlFor={control.controlProps.id}>{label}</FieldLabel>
      <Textarea
        {...textareaProps}
        {...control.controlProps}
        name={field.name}
        value={field.state.value}
        onChange={(event) => field.handleChange(event.target.value)}
      />
      {control.messages}
    </Field>
  );
}

type SelectOption<TValue> = { value: TValue; label: string };

function SelectField<TValue>({
  label,
  description,
  items,
  disabled,
}: FieldText & {
  items: readonly SelectOption<TValue>[];
  disabled?: boolean;
}) {
  const field = useFieldContext<TValue>();
  const control = useFieldControl(description);

  return (
    <Field data-invalid={control.invalid} data-disabled={disabled}>
      <FieldLabel htmlFor={control.controlProps.id}>{label}</FieldLabel>
      <Select
        name={field.name}
        items={items}
        value={field.state.value}
        onValueChange={(value) => {
          if (value !== null) field.handleChange(value);
        }}
        disabled={disabled}
      >
        <SelectTrigger {...control.controlProps} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={String(item.value)} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {control.messages}
    </Field>
  );
}

function CheckboxField({
  label,
  description,
  disabled,
}: FieldText & { disabled?: boolean }) {
  const field = useFieldContext<boolean>();
  const control = useFieldControl(description);

  return (
    <Field
      orientation="horizontal"
      data-invalid={control.invalid}
      data-disabled={disabled}
    >
      <Checkbox
        {...control.controlProps}
        name={field.name}
        checked={field.state.value}
        onCheckedChange={(checked) => field.handleChange(checked)}
        disabled={disabled}
      />
      <FieldContent>
        <FieldLabel htmlFor={control.controlProps.id}>{label}</FieldLabel>
        {control.messages}
      </FieldContent>
    </Field>
  );
}

function SwitchField({
  label,
  description,
  disabled,
}: FieldText & { disabled?: boolean }) {
  const field = useFieldContext<boolean>();
  const control = useFieldControl(description);

  return (
    <Field
      orientation="horizontal"
      data-invalid={control.invalid}
      data-disabled={disabled}
    >
      <FieldContent>
        <FieldLabel htmlFor={control.controlProps.id}>{label}</FieldLabel>
        {control.messages}
      </FieldContent>
      <Switch
        {...control.controlProps}
        name={field.name}
        checked={field.state.value}
        onCheckedChange={(checked) => field.handleChange(checked)}
        disabled={disabled}
      />
    </Field>
  );
}

/** A submit button whose pending state comes from the form's `isSubmitting`. */
function SubmitButton(
  props: Omit<ComponentProps<typeof Button>, "type" | "pending">,
) {
  const form = useFormContext();

  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <Button {...props} type="submit" pending={isSubmitting} />
      )}
    </form.Subscribe>
  );
}

/**
 * The `<form>` element for an app form. `noValidate` makes the Zod schema the
 * only validator. A failed submit moves focus to the first invalid field,
 * which the browser did before `noValidate` turned its validation off.
 */
function Form({
  children,
  ...props
}: Omit<ComponentProps<"form">, "onSubmit" | "noValidate">) {
  const form = useFormContext();

  return (
    <form
      {...props}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const element = event.currentTarget;
        form.handleSubmit().then(
          () => {
            if (form.state.isValid) return;
            // Wait a frame so the fields render their aria-invalid state.
            requestAnimationFrame(() => {
              element
                .querySelector<HTMLElement>('[aria-invalid="true"]')
                ?.focus();
            });
          },
          // `onSubmit` handlers run mutations, and the mutation cache already
          // toasts a failed mutation.
          () => {},
        );
      }}
    >
      {children}
    </form>
  );
}

export const { useAppForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    TextField,
    RowTextField,
    TextareaField,
    SelectField,
    CheckboxField,
    SwitchField,
  },
  formComponents: { Form, SubmitButton },
});
