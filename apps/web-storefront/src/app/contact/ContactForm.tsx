"use client";

import { useState, useCallback, FormEvent } from "react";
import { Send, ChevronDown, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CaptchaWidget } from "@/components/CaptchaWidget";
import { validateEmail } from "@/lib/validators";
import { ApiError } from "@/lib/api-client";
import { contactService } from "@/services/contact.service";

const CONTACT_METHODS = [
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "sms", label: "SMS" },
] as const;

type ContactMethod = (typeof CONTACT_METHODS)[number]["value"];

const REASONS = [
  "Order or delivery issue",
  "Returns & refunds",
  "Product question",
  "Seller / partnership enquiry",
  "Payment or billing",
  "Affiliate programme",
  "Something else",
];

const labelClass =
  "block text-caption uppercase tracking-wider font-semibold text-ink-700 mb-2";

const inputClass = (hasError: boolean) =>
  `w-full h-12 px-4 border bg-white text-body-lg placeholder:text-ink-400 focus:outline-none transition-colors rounded-full ${
    hasError
      ? "border-danger focus:border-danger"
      : "border-ink-300 hover:border-ink-500 focus:border-ink-900"
  }`;

export function ContactForm() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [method, setMethod] = useState<ContactMethod>("email");
  const [reason, setReason] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [status, setStatus] = useState<"idle" | "submitting" | "success">(
    "idle"
  );

  // Phone/SMS need a number to call/text; Email does not.
  const needsPhone = method === "phone" || method === "sms";

  const onCaptchaToken = useCallback(
    (token: string) => setCaptchaToken(token),
    []
  );

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError("");

    const next: Record<string, string> = {};
    if (!firstName.trim()) next.firstName = "First name is required.";
    if (!reason) next.reason = "Please choose a reason.";
    const emailErr = validateEmail(email);
    if (emailErr) next.email = emailErr;
    if (needsPhone) {
      const digits = phone.replace(/\D/g, "");
      if (!phone.trim()) next.phone = "Phone number is required.";
      else if (digits.length < 7 || digits.length > 15)
        next.phone = "Please enter a valid phone number.";
    }
    if (!message.trim()) next.message = "Please enter a message.";

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setStatus("submitting");
    try {
      await contactService.submit({
        firstName: firstName.trim(),
        lastName: lastName.trim() || undefined,
        contactMethod: method,
        reason,
        email: email.trim().toLowerCase(),
        phone: needsPhone ? phone.trim() : undefined,
        message: message.trim(),
        captchaToken: captchaToken || undefined,
      });
      setStatus("success");
    } catch (err) {
      // A failed submit burns the single-use CAPTCHA token — force a fresh one.
      setCaptchaResetKey((k) => k + 1);
      setCaptchaToken("");
      setStatus("idle");

      if (err instanceof ApiError) {
        if (err.status === 422 && err.body.errors) {
          const fieldErrors: Record<string, string> = {};
          for (const fe of err.body.errors) {
            if (!(fe.field in fieldErrors)) fieldErrors[fe.field] = fe.message;
          }
          setErrors(fieldErrors);
        } else if (err.status === 429) {
          setServerError(
            "Too many attempts. Please wait a moment and try again."
          );
        } else {
          setServerError(
            err.message || "Something went wrong. Please try again."
          );
        }
      } else {
        setServerError(
          "Network error. Please check your connection and try again."
        );
      }
    }
  };

  if (status === "success") {
    const methodLabel = CONTACT_METHODS.find(
      (m) => m.value === method
    )?.label.toLowerCase();
    return (
      <div
        role="status"
        className="flex items-start gap-3 p-4 border border-success/30 bg-green-50 text-success rounded-2xl"
      >
        <div>
          <p className="text-body-lg font-semibold">
            Thanks, {firstName || "there"}!
          </p>
          <p className="mt-1 text-body text-ink-700">
            Your message has been sent to our team. We will reach out via{" "}
            {methodLabel} soon.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {serverError && (
        <div
          role="alert"
          className="flex items-start gap-2 p-3 border border-danger/30 bg-red-50 text-danger rounded-2xl text-body"
        >
          <AlertCircle className="size-5 shrink-0 mt-0.5" strokeWidth={1.75} />
          <span>{serverError}</span>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="firstName" className={labelClass}>
            First name
          </label>
          <input
            id="firstName"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="First name"
            autoComplete="given-name"
            className={inputClass(!!errors.firstName)}
          />
          {errors.firstName && (
            <p role="alert" className="mt-1.5 text-caption text-danger">
              {errors.firstName}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="lastName" className={labelClass}>
            Last name
          </label>
          <input
            id="lastName"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Last name"
            autoComplete="family-name"
            className={inputClass(false)}
          />
        </div>
      </div>

      <fieldset className="border-0 p-0 m-0">
        <legend className={labelClass}>
          How do you want us to contact you?
        </legend>
        <div className="flex flex-wrap gap-2">
          {CONTACT_METHODS.map((m) => {
            const active = method === m.value;
            return (
              <label
                key={m.value}
                className={`inline-flex items-center gap-2 h-11 px-5 border rounded-full cursor-pointer text-body-lg transition-colors focus-within:ring-2 focus-within:ring-ink-900 focus-within:ring-offset-2 ${
                  active
                    ? "border-ink-900 bg-ink-900 text-white"
                    : "border-ink-300 text-ink-700 hover:border-ink-500"
                }`}
              >
                <input
                  type="radio"
                  name="contactMethod"
                  value={m.value}
                  checked={active}
                  onChange={() => {
                    setMethod(m.value);
                    // Clear any stale phone error when switching away/into Phone.
                    setErrors((prev) => ({ ...prev, phone: "" }));
                  }}
                  className="sr-only"
                />
                {m.label}
              </label>
            );
          })}
        </div>
      </fieldset>

      {needsPhone && (
        <div>
          <label htmlFor="phone" className={labelClass}>
            Phone number
          </label>
          <input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. +91 98765 43210"
            className={inputClass(!!errors.phone)}
          />
          {errors.phone && (
            <p role="alert" className="mt-1.5 text-caption text-danger">
              {errors.phone}
            </p>
          )}
        </div>
      )}

      <div>
        <label htmlFor="reason" className={labelClass}>
          Reason for contact
        </label>
        <div className="relative">
          <select
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={`${inputClass(
              !!errors.reason
            )} appearance-none pr-11 cursor-pointer ${
              reason ? "text-ink-900" : "text-ink-400"
            }`}
          >
            <option value="" disabled>
              Select a reason
            </option>
            {REASONS.map((r) => (
              <option key={r} value={r} className="text-ink-900">
                {r}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 size-4 text-ink-500"
            strokeWidth={2}
          />
        </div>
        {errors.reason && (
          <p role="alert" className="mt-1.5 text-caption text-danger">
            {errors.reason}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="email" className={labelClass}>
          Email
        </label>
        <input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter your email"
          className={inputClass(!!errors.email)}
        />
        {errors.email && (
          <p role="alert" className="mt-1.5 text-caption text-danger">
            {errors.email}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="message" className={labelClass}>
          Message
        </label>
        <textarea
          id="message"
          rows={5}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Your message"
          className={`w-full px-4 py-3 border bg-white text-body-lg placeholder:text-ink-400 focus:outline-none transition-colors rounded-2xl resize-y min-h-[140px] ${
            errors.message
              ? "border-danger focus:border-danger"
              : "border-ink-300 hover:border-ink-500 focus:border-ink-900"
          }`}
        />
        {errors.message && (
          <p role="alert" className="mt-1.5 text-caption text-danger">
            {errors.message}
          </p>
        )}
      </div>

      {/* Renders nothing when CAPTCHA is disabled (dev/staging default). */}
      <CaptchaWidget onToken={onCaptchaToken} resetKey={captchaResetKey} />

      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        loading={status === "submitting"}
        trailingIcon={<Send className="size-4" />}
      >
        Send message
      </Button>
    </form>
  );
}
