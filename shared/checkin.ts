export type CheckinField = {
  id: string;
  label: string;
  required: boolean;
  placeholder?: string;
};

export type CheckinConfig = {
  enabled: boolean;
  startsAt: string;
  endsAt: string;
  askCompany: boolean;
  askStore: boolean;
  fields?: CheckinField[];
};

export function resolveCheckinFields(
  cfg?: Partial<CheckinConfig> | null,
): CheckinField[] {
  if (Array.isArray(cfg?.fields)) {
    return cfg.fields;
  }
  const list: CheckinField[] = [];
  if (cfg?.askCompany) {
    list.push({
      id: "company",
      label: "公司 / 单位",
      required: false,
      placeholder: "请输入公司名称",
    });
  }
  if (cfg?.askStore) {
    list.push({
      id: "store",
      label: "门店 / 部门",
      required: false,
      placeholder: "请输入所属门店",
    });
  }
  return list;
}
