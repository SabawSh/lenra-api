import { resolveDueAt } from "@/helper/date";
import { markReminderOptInEligible } from "@/lib/push/client/storage";
import { ReminderOption } from "@/types/learning";

export const saveReminderSelection = async (partId: string, option: ReminderOption) => {
  const dueAt = resolveDueAt(option);

  console.time("reminder-click-api-reminder");
  try {
    const res = await fetch("/api/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partId,
        dueAt: dueAt.toISOString(),
      }),
    });

    if (res.ok) {
      markReminderOptInEligible();
    }
  } finally {
    console.timeEnd("reminder-click-api-reminder");
  }
};
