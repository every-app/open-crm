import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { SectionHeader } from "@/client/components/PageHeader";
import { QueryState } from "@/client/components/QueryState";
import { everyAppAccountQueryOptions } from "@/client/components/Sidebar";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { membersQueryOptions } from "@/client/features/members/memberQueries";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

// Roles may arrive comma-joined.
function formatRole(role: string) {
  return role
    .split(",")
    .map((name) => ROLE_LABELS[name.trim()] ?? name.trim())
    .join(", ");
}

/**
 * Settings → Members: who has opened the CRM, read only. The Every App
 * gateway owns the real list: invitations, roles and removals happen there.
 */
export function MembersSettings() {
  const membersQuery = useQuery(membersQueryOptions());
  const { data: account } = useQuery(everyAppAccountQueryOptions());
  const gatewayUrl = account?.gatewayUrl ?? null;

  return (
    <section className="space-y-3">
      <SectionHeader
        title="Members"
        action={
          gatewayUrl ? (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<a href={gatewayUrl} target="_blank" rel="noreferrer" />}
            >
              Manage on Every App
              <ExternalLink data-icon="inline-end" aria-hidden />
            </Button>
          ) : null
        }
      />
      <p className="max-w-2xl text-sm text-muted-foreground">
        Everyone in your organization who has opened the CRM. Invitations, roles
        and removals are managed on your Every App gateway.
      </p>
      <QueryState
        query={membersQuery}
        errorFallback="The members could not be loaded."
      >
        {(members) => (
          <TableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <TableRow key={member.userId}>
                    <TableCell className="max-w-[320px]">
                      <p className="truncate font-medium">
                        {member.name || member.email}
                        {member.userId === account?.userId ? (
                          <span className="font-normal text-muted-foreground">
                            {" "}
                            (you)
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {member.email}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {formatRole(member.role)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        )}
      </QueryState>
    </section>
  );
}
