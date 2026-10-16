"""IP 属地：把客户端 IP 解析成「省 / 国家」，供个人主页与评论显示「IP属地」。

★ 为什么用**离线库**而不是在线接口：
  在线接口（ip-api 之类）会把用户 IP 发给第三方、有调用额度、还会因为网络抖动让功能时好时坏；
  公开展示 IP 属地的同时又把 IP 交给第三方，本身也别扭。所以用 ip2region 的离线数据文件，
  本地查、零外部依赖、无限额。

数据文件：`data/ip2region_v4.xdb`（约 11MB，可用 backend/update_ip2region.py 更新）。
读取器按官方结构规范自己实现（没引第三方包，PyPI 上也没有官方包）：
  https://ip2region.net/doc/xdb/structure
    [0, 256)           Header：版本(2) 缓存策略(2) 生成时间(4) 索引起始(4) 索引结束(4)
                              IP版本(2) 指针字节(2) 预留(236)
    [256, +512KiB)     Vector 索引：256×256 格，每格 8 字节（起始指针 4 + 结束指针 4）
    之后                地域信息段（utf-8 字符串，去重后连续存放）
    再之后              二分索引段：IPv4 每条 14 字节 = 起始IP(4)+结束IP(4)+数据长度(2)+数据指针(4)
  全部**小端序**。

region 字段格式：`国家|省份|城市|ISP|iso-alpha2`；中国是中文，境外是英文（所以下面带一张国名表）。

⚠️ 数据准确性：离线库是按 IP 段归属整理的，机房 IP（尤其香港/新加坡一带）常被标成
邻近国家或地区。定位到省/国家这一档够用，但别当权威数据，也不要用于安全判定。
"""
from __future__ import annotations

import ipaddress
import struct
import threading
from functools import lru_cache

from . import config

VECTOR_OFFSET = 256
VECTOR_SIZE = 256 * 256 * 8
ENTRY_SIZE = 14          # IPv4 二分索引条目
XDB_VERSION = 3

_buf: bytes | None = None
_index_start = 0
_index_end = 0
_load_lock = threading.Lock()
_load_failed = False


def _load() -> bytes | None:
    """懒加载整个 xdb 到内存（11MB；只读，多线程安全）。文件缺失就返回 None，功能自动降级。"""
    global _buf, _index_start, _index_end, _load_failed

    if _buf is not None:
        return _buf
    if _load_failed:
        return None
    with _load_lock:
        if _buf is not None:
            return _buf
        path = config.IP2REGION_XDB
        try:
            with open(path, "rb") as f:
                data = f.read()
        except OSError:
            _load_failed = True
            return None
        if len(data) < VECTOR_OFFSET + VECTOR_SIZE + ENTRY_SIZE:
            _load_failed = True
            return None
        ip_version, _ptr = struct.unpack_from("<HH", data, 16)
        if ip_version != 4:
            # 只支持 IPv4 库（IPv6 的文件结构不同，条目 38 字节）
            _load_failed = True
            return None
        _buf = data
        _index_start, _index_end = struct.unpack_from("<II", data, 8)
        return _buf


def _u32(o: int) -> int:
    return struct.unpack_from("<I", _buf, o)[0]


def _u16(o: int) -> int:
    return struct.unpack_from("<H", _buf, o)[0]


def _search_raw(ip: str) -> str:
    """在 xdb 里二分查找，返回原始 region 串（如 `中国|山东省|济南市|电信|CN`）。"""
    buf = _load()
    if buf is None:
        return ""
    try:
        addr = ipaddress.IPv4Address(ip)
    except (ipaddress.AddressValueError, ValueError):
        return ""
    ipi = int(addr)
    a = (ipi >> 24) & 0xFF
    b = (ipi >> 16) & 0xFF

    cell = VECTOR_OFFSET + ((a << 8) | b) * 8
    lo, hi = _u32(cell), _u32(cell + 4)
    while lo <= hi:
        mid = lo + (((hi - lo) // ENTRY_SIZE) // 2) * ENTRY_SIZE
        if mid > _index_end:
            break
        s, e, dl, dp = _u32(mid), _u32(mid + 4), _u16(mid + 8), _u32(mid + 10)
        if ipi < s:
            hi = mid - ENTRY_SIZE
        elif ipi > e:
            lo = mid + ENTRY_SIZE
        else:
            return buf[dp:dp + dl].decode("utf-8", "replace")
    return ""


def is_public_ip(ip: str) -> bool:
    """能不能拿这个 IP 定位：只有**全球可路由**的地址才展示属地。

    用 is_global 而不是 is_private：后者会把运营商级 NAT（100.64.0.0/10）、
    基准测试段（198.18.0.0/15）、文档段（203.0.113.0/24）这些都算成「公网」，
    而它们根本不属于任何用户。is_global 一次性把这些排除干净。
    """
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return False
    # ⚠️ 别只信 is_global：CPython 里组播地址（224.0.0.0/4）的 is_global 是 True
    #    （is_private 的网段清单里没有它），所以这些必须显式排掉。
    if a.is_multicast or a.is_reserved or a.is_loopback or a.is_link_local or a.is_unspecified:
        return False
    return bool(a.is_global)


# ---------------------------------------------------------------------------
# 中国 34 个省级行政区，**统一输出全称**（辽宁省 / 广东省 / 新疆维吾尔自治区 / 香港特别行政区 / 台湾省 / 上海市…）
# ---------------------------------------------------------------------------
# 实测扫过全库 553,954 条索引：中国的省份字段一共只有 34 种写法，且
# 「省 / 直辖市 / 特别行政区 / 台湾省」本来就是全称，**只有 5 个自治区是简称**（广西、新疆、内蒙古、宁夏、西藏）。
# 所以这里做的是「把简称补成全称」，全称原样通过 —— 不是把全称截短（那是上一版的做法，已按站长要求改掉）。
_PROVINCE_FULL = (
    "北京市", "天津市", "上海市", "重庆市",
    "河北省", "山西省", "辽宁省", "吉林省", "黑龙江省", "江苏省", "浙江省", "安徽省",
    "福建省", "江西省", "山东省", "河南省", "湖北省", "湖南省", "广东省", "海南省",
    "四川省", "贵州省", "云南省", "陕西省", "甘肃省", "青海省", "台湾省",
    "内蒙古自治区", "广西壮族自治区", "西藏自治区", "宁夏回族自治区", "新疆维吾尔自治区",
    "香港特别行政区", "澳门特别行政区",
)
# 后缀长的排前面，否则「新疆维吾尔自治区」会被「自治区」先截成「新疆维吾尔」
_PROVINCE_SUFFIX = ("维吾尔自治区", "壮族自治区", "回族自治区", "特别行政区", "自治区", "省", "市")

_PROVINCE_ALIAS: dict[str, str] = {}
for _full in _PROVINCE_FULL:
    _PROVINCE_ALIAS[_full] = _full
    for _suf in _PROVINCE_SUFFIX:
        if _full.endswith(_suf):
            _PROVINCE_ALIAS.setdefault(_full[: -len(_suf)], _full)
            break


def _cn_province(province: str) -> str:
    """省份字段 → 全称。表里没有的（极少见）原样返回，不猜。"""
    p = (province or "").strip()
    if not p or p == "0":
        return "中国"          # 库里这 702 条只到国家一级，就显示「中国」
    return _PROVINCE_ALIAS.get(p, p)


# 34 个省级行政区全称，对外公开一份：活动按省分区（app/map_event.py）直接用它，
# 不另外抄一张省名表 —— 抄两份迟早会有一份漏掉「新疆维吾尔自治区」这种长名字。
PROVINCES = _PROVINCE_FULL


def province_of(region_display: str) -> str:
    """展示用属地文案 → 省级行政区全称（「辽宁省」/「新疆维吾尔自治区」）。

    只有 34 个省级行政区才算：境外（「美国」）、只到国家一级（「中国」）和空串一律返回空串，
    调用方据此判断「这个人/这件作品能不能代表某个省」（点亮地图活动就是这么用的）。
    """
    r = (region_display or "").strip()
    return r if r in _PROVINCE_FULL else ""


# ISO 3166-1 alpha-2 → 中文国名。库里境外数据是英文，靠这张表转中文。
# ⚠️ 这张表是**照着库里实际出现的国家逐个补齐**的：那天扫全库发现还有 64 个
#    小国/属地漏了（塞舌尔、马恩岛、库拉索、留尼汪…），只靠常见国家会让它们显示英文。
COUNTRY_ZH = {
    # 亚洲
    "CN": "中国", "HK": "香港特别行政区", "MO": "澳门特别行政区", "TW": "台湾省",
    "JP": "日本", "KR": "韩国", "KP": "朝鲜", "MN": "蒙古", "SG": "新加坡",
    "MY": "马来西亚", "TH": "泰国", "VN": "越南", "PH": "菲律宾", "ID": "印度尼西亚",
    "IN": "印度", "PK": "巴基斯坦", "BD": "孟加拉国", "LK": "斯里兰卡", "NP": "尼泊尔",
    "MM": "缅甸", "KH": "柬埔寨", "LA": "老挝", "BN": "文莱", "MV": "马尔代夫",
    "BT": "不丹", "TL": "东帝汶", "KZ": "哈萨克斯坦", "UZ": "乌兹别克斯坦",
    "KG": "吉尔吉斯斯坦", "TJ": "塔吉克斯坦", "TM": "土库曼斯坦", "AF": "阿富汗",
    # 欧洲
    "GB": "英国", "IE": "爱尔兰", "FR": "法国", "DE": "德国", "IT": "意大利",
    "ES": "西班牙", "PT": "葡萄牙", "NL": "荷兰", "BE": "比利时", "LU": "卢森堡",
    "CH": "瑞士", "AT": "奥地利", "SE": "瑞典", "NO": "挪威", "DK": "丹麦",
    "FI": "芬兰", "IS": "冰岛", "PL": "波兰", "CZ": "捷克", "SK": "斯洛伐克",
    "HU": "匈牙利", "RO": "罗马尼亚", "BG": "保加利亚", "GR": "希腊", "HR": "克罗地亚",
    "SI": "斯洛文尼亚", "RS": "塞尔维亚", "BA": "波黑", "ME": "黑山", "MK": "北马其顿",
    "AL": "阿尔巴尼亚", "EE": "爱沙尼亚", "LV": "拉脱维亚", "LT": "立陶宛",
    "BY": "白俄罗斯", "UA": "乌克兰", "MD": "摩尔多瓦", "RU": "俄罗斯", "MT": "马耳他",
    "CY": "塞浦路斯", "MC": "摩纳哥", "LI": "列支敦士登", "AD": "安道尔", "SM": "圣马力诺",
    # 美洲
    "US": "美国", "CA": "加拿大", "MX": "墨西哥", "BR": "巴西", "AR": "阿根廷",
    "CL": "智利", "CO": "哥伦比亚", "PE": "秘鲁", "VE": "委内瑞拉", "EC": "厄瓜多尔",
    "UY": "乌拉圭", "PY": "巴拉圭", "BO": "玻利维亚", "CR": "哥斯达黎加",
    "PA": "巴拿马", "CU": "古巴", "DO": "多米尼加", "GT": "危地马拉", "HN": "洪都拉斯",
    "SV": "萨尔瓦多", "NI": "尼加拉瓜", "JM": "牙买加", "TT": "特立尼达和多巴哥",
    "BS": "巴哈马", "BB": "巴巴多斯", "HT": "海地", "PR": "波多黎各",
    # 大洋洲
    "AU": "澳大利亚", "NZ": "新西兰", "FJ": "斐济", "PG": "巴布亚新几内亚",
    "GU": "关岛", "NC": "新喀里多尼亚", "SB": "所罗门群岛", "VU": "瓦努阿图",
    "WS": "萨摩亚", "TO": "汤加",
    # 非洲
    "ZA": "南非", "EG": "埃及", "NG": "尼日利亚", "KE": "肯尼亚", "ET": "埃塞俄比亚",
    "MA": "摩洛哥", "DZ": "阿尔及利亚", "TN": "突尼斯", "LY": "利比亚", "GH": "加纳",
    "TZ": "坦桑尼亚", "UG": "乌干达", "RW": "卢旺达", "SN": "塞内加尔",
    "CI": "科特迪瓦", "CM": "喀麦隆", "ZW": "津巴布韦", "ZM": "赞比亚",
    "MZ": "莫桑比克", "AO": "安哥拉", "SD": "苏丹", "SO": "索马里", "ML": "马里",
    "BF": "布基纳法索", "NE": "尼日尔", "TD": "乍得", "CD": "刚果（金）",
    "CG": "刚果（布）", "GA": "加蓬", "BW": "博茨瓦纳", "NA": "纳米比亚",
    "MU": "毛里求斯", "MG": "马达加斯加", "MW": "马拉维", "DJ": "吉布提",
    "ER": "厄立特里亚", "GM": "冈比亚", "GN": "几内亚", "SL": "塞拉利昂",
    "LR": "利比里亚", "TG": "多哥", "BJ": "贝宁", "BI": "布隆迪", "LS": "莱索托",
    "SZ": "斯威士兰", "MR": "毛里塔尼亚", "CV": "佛得角",
    # 中东 / 高加索
    "SA": "沙特阿拉伯", "AE": "阿联酋", "IL": "以色列", "IR": "伊朗", "IQ": "伊拉克",
    "QA": "卡塔尔", "KW": "科威特", "OM": "阿曼", "BH": "巴林", "JO": "约旦",
    "LB": "黎巴嫩", "SY": "叙利亚", "YE": "也门", "PS": "巴勒斯坦",
    "GE": "格鲁吉亚", "AM": "亚美尼亚", "AZ": "阿塞拜疆", "TR": "土耳其",
    # 小国 / 属地（这些是补扫全库后加的，否则会直接显示英文）
    "SC": "塞舌尔", "RE": "留尼汪", "IM": "马恩岛", "JE": "泽西岛", "GD": "格林纳达",
    "AG": "安提瓜和巴布达", "GI": "直布罗陀", "MQ": "马提尼克", "VG": "英属维尔京群岛",
    "BZ": "伯利兹", "LC": "圣卢西亚", "GG": "根西岛", "KN": "圣基茨和尼维斯",
    "XK": "科索沃", "BM": "百慕大", "DM": "多米尼克", "VC": "圣文森特和格林纳丁斯",
    "KY": "开曼群岛", "CW": "库拉索", "VI": "美属维尔京群岛", "GY": "圭亚那",
    "GP": "瓜德罗普", "SS": "南苏丹", "GL": "格陵兰", "FO": "法罗群岛",
    "AW": "阿鲁巴", "MF": "圣马丁", "FM": "密克罗尼西亚", "GF": "法属圭亚那",
    "GQ": "赤道几内亚", "AX": "奥兰群岛", "SR": "苏里南", "PF": "法属波利尼西亚",
    "PW": "帕劳", "SX": "荷属圣马丁", "AS": "美属萨摩亚", "BQ": "荷兰加勒比区",
    "NR": "瑙鲁", "AI": "安圭拉", "KI": "基里巴斯", "CF": "中非共和国",
    "KM": "科摩罗", "MH": "马绍尔群岛", "PM": "圣皮埃尔和密克隆",
    "ST": "圣多美和普林西比", "TV": "图瓦卢", "GW": "几内亚比绍", "VA": "梵蒂冈",
    "NU": "纽埃", "TC": "特克斯和凯科斯群岛", "BL": "圣巴泰勒米", "MS": "蒙特塞拉特",
    "WF": "瓦利斯和富图纳", "CK": "库克群岛", "TK": "托克劳", "FK": "福克兰群岛",
    "MP": "北马里亚纳群岛", "NF": "诺福克岛", "YT": "马约特",
    "IO": "英属印度洋领地", "SH": "圣赫勒拿", "AQ": "南极洲",
    "SJ": "斯瓦尔巴和扬马延", "PN": "皮特凯恩群岛",
}

# 库里少数行的 iso 是 0/空，这时用英文国名兜底
COUNTRY_EN_ZH = {
    "United States": "美国", "China": "中国", "Japan": "日本", "South Korea": "韩国",
    "Korea": "韩国", "Hong Kong": "香港特别行政区", "Macao": "澳门特别行政区",
    "Macau": "澳门特别行政区",
    "Taiwan": "台湾省", "Singapore": "新加坡", "Malaysia": "马来西亚", "Thailand": "泰国",
    "Viet Nam": "越南", "Vietnam": "越南", "Philippines": "菲律宾", "Indonesia": "印度尼西亚",
    "India": "印度", "Australia": "澳大利亚", "New Zealand": "新西兰", "Canada": "加拿大",
    "United Kingdom": "英国", "Germany": "德国", "France": "法国", "Netherlands": "荷兰",
    "Russia": "俄罗斯", "Brazil": "巴西",
}


def to_display(region: str) -> str:
    """原始 region 串 → 展示用的属地文案（如 辽宁省 / 新疆维吾尔自治区 / 香港特别行政区 / 美国）。"""
    if not region:
        return ""
    parts = [p.strip() for p in region.split("|")]
    country = parts[0] if parts else ""
    province = parts[1] if len(parts) > 1 else ""
    iso = (parts[4] if len(parts) > 4 else "").upper()
    if not country or country in ("Reserved", "0"):
        return ""
    if country == "中国":
        return _cn_province(province)
    return COUNTRY_ZH.get(iso) or COUNTRY_EN_ZH.get(country) or country


@lru_cache(maxsize=8192)
def region_of(ip: str) -> str:
    """IP → 属地文案。内网/保留地址、查不到、库缺失都返回空串（调用方据此不展示）。"""
    if not ip or not is_public_ip(ip):
        return ""
    return to_display(_search_raw(ip))


def available() -> bool:
    """数据文件是否可用（排障用）。"""
    return _load() is not None


def publisher_region(ip: str, user=None) -> str:
    """**发布内容时**要存进快照的属地：优先按这次请求的 IP 判定。

    为什么要优先用请求 IP 而不是用户行里的缓存值：`users.ip_region` 是按 1 小时节流刷新的，
    可能滞后（用户刚换了地方就发帖）。发布这一刻的 IP 最准。
    请求 IP 判不出来（内网/保留/查不到/库缺失）时，回退到用户行里的最后已知属地，
    再不行就空串（前端不显示）。
    固定属地的账号（管理员官号）直接用它。
    """
    fixed = fixed_region(user) if user is not None else ""
    if fixed:
        return fixed
    return region_of(ip) or ((getattr(user, "ip_region", "") or "") if user is not None else "")


def fixed_region(user) -> str:
    """**不按 IP 判定**的固定属地：管理员官号统一显示香港（站长要求）。

    命中条件（见 config）：
      · role == 'admin'  —— 官方管理账号
      · uid 在 NIMAO_IP_REGION_FIXED_UIDS 里（默认空）
    但**豁免名单优先**：uid 在 NIMAO_IP_REGION_PIN_EXEMPT_UIDS 里的账号永远不固定
    （站长的个人号虽然拿到了 admin 权限，但他要求个人号照常显示真实属地）。
    判定只放在这一处，序列化（个人主页 / 评论 / 后台）和写入（deps.touch_ip_region）
    都调它，避免两边规则不一致。返回空串表示「照常按 IP 判定」。
    """
    if not config.IP_REGION_ADMIN_FIXED:
        return ""
    uid = str(getattr(user, "uid", "") or "")
    if uid and uid in config.IP_REGION_PIN_EXEMPT_UIDS:
        return ""
    if getattr(user, "role", "") == "admin":
        return config.IP_REGION_ADMIN_FIXED
    if uid and uid in config.IP_REGION_FIXED_UIDS:
        return config.IP_REGION_ADMIN_FIXED
    return ""
