import { pool } from "@/lib/db/connection";
import type { RowDataPacket } from "mysql2/promise";

export type AdminOverviewKpis = {
  totalUsers: number;
  newUsers7d: number;
  activeUsers7d: number;
  activeUsers30d: number;
  activePaidUsers: number;
  trialUsers: number;
};

export type AdminUsersSeriesRow = {
  day: string;
  newUsers: number;
  activeUsers: number;
};

export type AdminPlanBreakdownRow = {
  planKey: string;
  users: number;
};

export type AdminOverviewData = {
  kpis: AdminOverviewKpis;
  usersSeries: AdminUsersSeriesRow[];
  planBreakdown: AdminPlanBreakdownRow[];
};

function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function getAdminOverviewData(): Promise<AdminOverviewData> {
  type KpiRow = RowDataPacket & {
    total_users: number;
    new_users_7d: number;
    active_users_7d: number;
    active_users_30d: number;
    active_paid_users: number;
    trial_users: number;
  };

  const [kpiRows] = await pool.query<KpiRow[]>(
    `
      SELECT
        (SELECT COUNT(*) FROM users) AS total_users,
        (
          SELECT COUNT(*)
          FROM users
          WHERE created_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY
        ) AS new_users_7d,
        (
          SELECT COUNT(*)
          FROM users
          WHERE last_active >= UTC_TIMESTAMP() - INTERVAL 7 DAY
        ) AS active_users_7d,
        (
          SELECT COUNT(*)
          FROM users
          WHERE last_active >= UTC_TIMESTAMP() - INTERVAL 30 DAY
        ) AS active_users_30d,
        (
          SELECT COUNT(DISTINCT us.user_id)
          FROM user_subscriptions us
          WHERE us.status = 'active'
            AND us.expires_at > UTC_TIMESTAMP(3)
        ) AS active_paid_users,
        (
          SELECT COUNT(*)
          FROM users u
          WHERE u.created_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY
            AND NOT EXISTS (
              SELECT 1
              FROM user_subscriptions us
              WHERE us.user_id = u.id
                AND us.status = 'active'
                AND us.expires_at > UTC_TIMESTAMP(3)
            )
        ) AS trial_users
    `,
  );

  type NewUsersRow = RowDataPacket & {
    day_key: string;
    total: number;
  };

  type ActiveUsersRow = RowDataPacket & {
    day_key: string;
    total: number;
  };

  type PlanRow = RowDataPacket & {
    plan_key: string | null;
    users: number;
  };

  const [newUsersRows, activeUsersRows, planRows] = await Promise.all([
    pool.query<NewUsersRow[]>(
      `
        SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day_key, COUNT(*) AS total
        FROM users
        WHERE created_at >= UTC_TIMESTAMP() - INTERVAL 14 DAY
        GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')
        ORDER BY day_key ASC
      `,
    ),
    pool.query<ActiveUsersRow[]>(
      `
        SELECT DATE_FORMAT(last_active, '%Y-%m-%d') AS day_key, COUNT(*) AS total
        FROM users
        WHERE last_active IS NOT NULL
          AND last_active >= UTC_TIMESTAMP() - INTERVAL 14 DAY
        GROUP BY DATE_FORMAT(last_active, '%Y-%m-%d')
        ORDER BY day_key ASC
      `,
    ),
    pool.query<PlanRow[]>(
      `
        SELECT plan_key, COUNT(DISTINCT user_id) AS users
        FROM user_subscriptions
        WHERE status = 'active'
          AND expires_at > UTC_TIMESTAMP(3)
        GROUP BY plan_key
        ORDER BY users DESC, plan_key ASC
      `,
    ),
  ]);

  const newUsersByDay = new Map(
    newUsersRows[0].map((row) => [String(row.day_key), Number(row.total)]),
  );
  const activeUsersByDay = new Map(
    activeUsersRows[0].map((row) => [String(row.day_key), Number(row.total)]),
  );

  const usersSeries: AdminUsersSeriesRow[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const day = toDayKey(d);
    usersSeries.push({
      day,
      newUsers: newUsersByDay.get(day) ?? 0,
      activeUsers: activeUsersByDay.get(day) ?? 0,
    });
  }

  return {
    kpis: {
      totalUsers: Number(kpiRows[0]?.total_users ?? 0),
      newUsers7d: Number(kpiRows[0]?.new_users_7d ?? 0),
      activeUsers7d: Number(kpiRows[0]?.active_users_7d ?? 0),
      activeUsers30d: Number(kpiRows[0]?.active_users_30d ?? 0),
      activePaidUsers: Number(kpiRows[0]?.active_paid_users ?? 0),
      trialUsers: Number(kpiRows[0]?.trial_users ?? 0),
    },
    usersSeries,
    planBreakdown: planRows[0].map((row) => ({
      planKey: row.plan_key ?? "unknown",
      users: Number(row.users),
    })),
  };
}

