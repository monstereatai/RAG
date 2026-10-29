export type TagType = {
  key: string;
  label: string;
};

export type CurrentUser = {
  name: string;
  avatar: string;
  userid: string;
  email: string;
  signature: string;
  title: string;
  group: string;
  tags: TagType[];
  notifyCount: number;
  unreadCount: number;
  country: string;
  phone: string;
};
