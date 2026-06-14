export enum CampaignStatus {
  Draft = 'draft',
  Scheduled = 'scheduled',
  Running = 'running',
  Paused = 'paused',
  Completed = 'completed',
  Cancelled = 'cancelled',
}

export enum StepType {
  Email = 'email',
  Delay = 'delay',
  Condition = 'condition',
  WebhookWait = 'webhook_wait',
}

// Condition fields for sequence branching
export enum ConditionField {
  Opened = 'opened',
  Clicked = 'clicked',
  Replied = 'replied',
  SaraIntent = 'sara_intent',
  DcsScore = 'dcs_score',
  WebhookReceived = 'webhook_received',
}

export enum ConditionOperator {
  Equals = 'equals',
  NotEquals = 'not_equals',
  GreaterThan = 'greater_than',
  LessThan = 'less_than',
  Contains = 'contains',
  IsTrue = 'is_true',
  IsFalse = 'is_false',
}

// Webhook event types
export enum WebhookEventType {
  ContactCreated = 'contact.created',
  ContactUpdated = 'contact.updated',
  ContactVerified = 'contact.verified',
  CampaignLaunched = 'campaign.launched',
  CampaignPaused = 'campaign.paused',
  CampaignCompleted = 'campaign.completed',
  SequenceStepExecuted = 'sequence.step_executed',
  EmailSent = 'email.sent',
  EmailOpened = 'email.opened',
  EmailClicked = 'email.clicked',
  EmailReplied = 'email.replied',
  EmailBounced = 'email.bounced',
  LeadUnsubscribed = 'lead.unsubscribed',
  SaraIntentClassified = 'sara.intent_classified',
  SaraReplyApproved = 'sara.reply_approved',
  AccountHealthDropped = 'account.health_dropped',
  LeadDataRefreshed = 'lead.data_refreshed',
}

export enum ContactCampaignStatus {
  Pending = 'pending',
  Active = 'active',
  Completed = 'completed',
  Replied = 'replied',
  Bounced = 'bounced',
  Unsubscribed = 'unsubscribed',
  Suppressed = 'suppressed',
  Error = 'error',
}

export enum ActivityType {
  Sent = 'sent',
  Delivered = 'delivered',
  Opened = 'opened',
  Clicked = 'clicked',
  Replied = 'replied',
  Bounced = 'bounced',
  Unsubscribed = 'unsubscribed',
  Error = 'error',
}

export enum ContactSource {
  Manual = 'manual',
  CsvImport = 'csv_import',
  Api = 'api',
}

// SARA Intent Classification
export enum SaraIntent {
  Interested = 'interested',
  Meeting = 'meeting',
  Objection = 'objection',
  NotNow = 'not_now',
  Unsubscribe = 'unsubscribe',
  OutOfOffice = 'out_of_office',
  Bounce = 'bounce',
  Other = 'other',
}

// SARA Recommended Action
export enum SaraAction {
  Reply = 'reply',
  Unsubscribe = 'unsubscribe',
  StopSequence = 'stop_sequence',
  Archive = 'archive',
  Escalate = 'escalate',
}

// SARA Review Status
export enum SaraStatus {
  PendingReview = 'pending_review',
  Approved = 'approved',
  Sent = 'sent',
  Dismissed = 'dismissed',
}
