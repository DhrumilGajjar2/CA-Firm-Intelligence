"use client";

import { useState } from "react";
import { UserRoundSearch } from "lucide-react";
import {
  USER_ROLES,
  USER_STATUS_FILTERS,
  type FirmUser,
  type PaginationMeta,
  type UserRole,
  type UserStatusFilter,
} from "@ca-firm/shared-types";
import { SelectInput } from "@/components/forms/native-controls";
import { EmptyState } from "@/components/layout/empty-state";
import { Pagination } from "@/components/tables/pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatDate, formatDateTime } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/roles";
import { ListError, ListSkeleton } from "./list-states";
import type { Notice } from "./team-notice";
import { RoleBadge, UserStatusBadge } from "./user-badges";
import { UserActionDialog, type UserAction } from "./user-actions";
import { useUsersList } from "./use-users";

export const USERS_PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

interface UsersSectionProps {
  /** Owner: shows per-row actions. Everyone else sees the list read-only. */
  canManage: boolean;
  currentUserId: string;
  timezone: string;
  onNotice: (notice: Notice) => void;
}

/** Team table with search, role/status filters and pagination. */
export function UsersSection({
  canManage,
  currentUserId,
  timezone,
  onNotice,
}: UsersSectionProps) {
  const [searchInput, setSearchInput] = useState("");
  const [role, setRole] = useState<UserRole | "">("");
  const [status, setStatus] = useState<UserStatusFilter | "">("");
  const [action, setAction] = useState<UserAction | null>(null);

  const search = useDebouncedValue(searchInput.trim(), SEARCH_DEBOUNCE_MS);

  // Any change to the filters (including clearing one, or returning to an earlier combination)
  // drops back to page 1; only the pagination controls change the page. Reset during render
  // (no effect, no extra request): the stored key follows the filters, so an old page can never
  // come back when a filter combination is revisited.
  const filterKey = JSON.stringify([search, role, status]);
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  if (pageState.key !== filterKey) setPageState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;

  const { data, isPending, isError, error, isFetching, isPlaceholderData, refetch } =
    useUsersList({
      page,
      limit: USERS_PAGE_SIZE,
      search: search || undefined,
      role: role || undefined,
      status: status || undefined,
    });

  const hasFilters = Boolean(searchInput.trim() || role || status);
  const clearFilters = () => {
    setSearchInput("");
    setRole("");
    setStatus("");
  };

  return (
    <section aria-labelledby="team-members-heading" className="flex flex-col gap-4">
      <h2 id="team-members-heading" className="sr-only">
        Team members
      </h2>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="search"
          aria-label="Search team members"
          placeholder="Search by name or email"
          maxLength={100}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="sm:max-w-xs"
        />
        <SelectInput
          aria-label="Filter by role"
          value={role}
          onChange={(e) => setRole(e.target.value as UserRole | "")}
          className="sm:w-40"
        >
          <option value="">All roles</option>
          {USER_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </SelectInput>
        <SelectInput
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatus(e.target.value as UserStatusFilter | "")}
          className="sm:w-40"
        >
          <option value="">All statuses</option>
          {USER_STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === "active" ? "Active" : "Inactive"}
            </option>
          ))}
        </SelectInput>
      </div>

      {isPending ? (
        <ListSkeleton label="Loading team members" />
      ) : isError || !data ? (
        <ListError
          title="We couldn't load the team"
          error={error}
          onRetry={() => void refetch()}
          retrying={isFetching}
        />
      ) : data.data.length === 0 ? (
        page > 1 ? (
          <EmptyState
            icon={UserRoundSearch}
            title="No team members on this page"
            description="The list changed since you last loaded it."
            action={
              <Button
                variant="outline"
                onClick={() => setPageState({ key: filterKey, page: 1 })}
              >
                Go to first page
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={UserRoundSearch}
            title={
              hasFilters ? "No team members match your filters" : "No team members yet"
            }
            description={
              hasFilters
                ? "Try a different search or clear the filters."
                : "People who join your firm will appear here."
            }
            action={
              hasFilters ? (
                <Button variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <div
          className={isPlaceholderData ? "opacity-60 transition-opacity" : undefined}
          aria-busy={isPlaceholderData}
        >
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last login</TableHead>
                  <TableHead>Joined</TableHead>
                  {canManage ? (
                    <TableHead className="text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((member) => (
                  <UserRow
                    key={member.id}
                    member={member}
                    isSelf={member.id === currentUserId}
                    canManage={canManage}
                    timezone={timezone}
                    onAction={setAction}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-4">
            <Pagination
              meta={metaFor(data.meta, page, data.data.length)}
              noun="members"
              disabled={isPlaceholderData}
              onPageChange={(next) => setPageState({ key: filterKey, page: next })}
            />
          </div>
        </div>
      )}

      {action ? (
        <UserActionDialog
          action={action}
          onClose={() => setAction(null)}
          onNotice={onNotice}
        />
      ) : null}
    </section>
  );
}

/** The API always sends `meta` for lists; this only keeps the UI sane if it were ever missing. */
export function metaFor(
  meta: PaginationMeta | undefined,
  page: number,
  count: number,
): PaginationMeta {
  return meta ?? { page, limit: Math.max(count, 1), total: count };
}

function UserRow({
  member,
  isSelf,
  canManage,
  timezone,
  onAction,
}: {
  member: FirmUser;
  isSelf: boolean;
  canManage: boolean;
  timezone: string;
  onAction: (action: UserAction) => void;
}) {
  // The backend refuses changes to the owner and to yourself (403); the UI simply offers neither.
  const showActions = canManage && member.role !== "owner" && !isSelf;
  return (
    <TableRow>
      <TableCell className="font-medium">
        {member.name}
        {isSelf ? (
          <Badge variant="outline" className="ml-2">
            You
          </Badge>
        ) : null}
      </TableCell>
      <TableCell>{member.email}</TableCell>
      <TableCell>
        <RoleBadge role={member.role} />
      </TableCell>
      <TableCell>
        <UserStatusBadge active={member.is_active} />
      </TableCell>
      <TableCell>
        {member.last_login_at ? formatDateTime(member.last_login_at, timezone) : "Never"}
      </TableCell>
      <TableCell>{formatDate(member.created_at, timezone)}</TableCell>
      {canManage ? (
        <TableCell className="text-right">
          {showActions ? (
            <div className="flex justify-end gap-1">
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Change role for ${member.name}`}
                onClick={() => onAction({ type: "role", user: member })}
              >
                Change role
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`${member.is_active ? "Deactivate" : "Reactivate"} ${member.name}`}
                onClick={() => onAction({ type: "status", user: member })}
              >
                {member.is_active ? "Deactivate" : "Reactivate"}
              </Button>
            </div>
          ) : null}
        </TableCell>
      ) : null}
    </TableRow>
  );
}
