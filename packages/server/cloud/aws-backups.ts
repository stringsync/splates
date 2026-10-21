/** The Data Lifecycle Manager policy: a daily snapshot, kept a week, of every instance tagged `tag`=`value`. */
export function dailyBackupPolicy(
	tag: string,
	value: string,
	roleArn: string,
): unknown {
	return {
		ExecutionRoleArn: roleArn,
		Description: `splates daily backups of ${tag}=${value}`,
		State: "ENABLED",
		PolicyDetails: {
			PolicyType: "EBS_SNAPSHOT_MANAGEMENT",
			ResourceTypes: ["INSTANCE"],
			TargetTags: [{ Key: tag, Value: value }],
			Schedules: [
				{
					Name: "daily",
					CopyTags: true,
					CreateRule: {
						Interval: 24,
						IntervalUnit: "HOURS",
						Times: ["03:00"],
					},
					RetainRule: { Count: 7 },
				},
			],
		},
	};
}
