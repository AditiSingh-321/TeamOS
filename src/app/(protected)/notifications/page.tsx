import { PageHeading } from "@/components/layout/page-heading";
import { Notifications,NotificationPreferences } from "@/components/collaboration/notifications";
export const metadata={title:"Notifications"};
export default function NotificationsPage(){return <div className="space-y-6"><PageHeading title="Notifications" description="Your assignments, mentions, reminders, and review requests."/><Notifications/><NotificationPreferences/></div>;}
