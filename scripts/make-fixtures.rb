# Generates one shared test scenario for MV, MZ, VX Ace, VX, XP (loose + packed).
require 'json'
require 'fileutils'

module RPG
  class System; end; class Map; end; class MapInfo; end; class Event; end
  class Event::Page; end; class Event::Page::Condition; end; class EventCommand; end
  class CommonEvent; end; class Troop; end; class Troop::Page; end; class Troop::Page::Condition; end
end
class Table
  def initialize(n) = @n = n
  def _dump(_) = [3, @n, @n, 1, @n * @n].pack('V5') + ("\0\0" * @n * @n)
end

ROOT = File.expand_path('../tests/fixtures', __dir__)
SW = [nil, 'Intro Done', 'Has Key', 'Boss Dead']
VA = [nil, 'Gold Count', 'Dest X', 'Steps']
def cmd(code, *params, indent: 0) = { code: code, indent: indent, parameters: params }
def cond(s1: nil, var: nil)
  { switch1_valid: !s1.nil?, switch1_id: s1 || 1, switch2_valid: false, switch2_id: 1,
    variable_valid: !var.nil?, variable_id: var ? var[0] : 1, variable_value: var ? var[1] : 0,
    self_switch_valid: false, self_switch_ch: 'A' }
end
def page(c, list) = { condition: c, list: list + [cmd(0)] }
MAPS = {
  1 => { name: 'Town', parent: 0, display: 'Sunny Town', events: [
    { id: 1, name: 'Elder', x: 3, y: 4, pages: [
      page(cond, [cmd(121, 1, 1, 0), cmd(201, 0, 2, 5, 5, 2, 0), cmd(117, 1)]),
      page(cond(s1: 1), [cmd(122, 3, 3, 0, 1, 1), cmd(111, 0, 2, 0), cmd(412)])] }] },
  2 => { name: 'Dungeon', parent: 1, display: 'Dark Cave', events: [
    { id: 1, name: 'Portal', x: 1, y: 1, pages: [
      page(cond(var: [3, 5]), [cmd(201, 1, 1, 2, 3, 0, 0), cmd(201, 0, 1, 1, 1, 2, 0), cmd(103, 2, 1)])] }] },
  3 => { name: 'Secret', parent: 2, display: '', events: [] },
  4 => { name: 'Missing', parent: 0, display: '', events: [] }, # no data file on purpose
}
CE = [{ id: 1, name: 'Ending', trigger: 2, switch_id: 3, list: [cmd(121, 2, 3, 1), cmd(201, 0, 3, 0, 0, 2, 0), cmd(0)] }]
TROOPS = [{ id: 1, name: 'Slimes', pages: [{ condition: { switch_valid: true, switch_id: 2 }, list: [cmd(122, 1, 1, 1, 0, 10), cmd(0)] }] }]

# ---- JSON (MV/MZ)
def camel(h) = h.to_h { |k, v| [k.to_s.gsub(/_([a-z0-9])/) { $1.upcase }, v] }
def write_json(dir, mz:)
  FileUtils.mkdir_p("#{dir}/data")
  sys = { gameTitle: mz ? 'Fixture MZ' : 'Fixture MV', switches: SW.map { _1 || '' }, variables: VA.map { _1 || '' } }
  sys[:advanced] = { gameId: 1 } if mz
  w = ->(n, o) { File.write("#{dir}/data/#{n}.json", JSON.generate(o)) }
  w['System', sys]
  w['MapInfos', [nil] + MAPS.map { |id, m| { id: id, name: m[:name], parentId: m[:parent], order: id } }]
  MAPS.each do |id, m|
    next if id == 4
    evs = [nil] + m[:events].map { |e| e.merge(pages: e[:pages].map { |p| { conditions: camel(p[:condition]), list: p[:list] } }) }
    w[format('Map%03d', id), { displayName: m[:display], width: 2, height: 2, data: [0] * 24, events: evs }]
  end
  w['CommonEvents', [nil] + CE.map { |c| { id: c[:id], name: c[:name], trigger: c[:trigger], switchId: c[:switch_id], list: c[:list] } }]
  w['Troops', [nil] + TROOPS.map { |t| t.merge(pages: t[:pages].map { |p| { conditions: camel(p[:condition]), list: p[:list] } }) }]
end

# ---- Marshal (VX Ace/XP)
def obj(klass, h) = klass.new.tap { |o| h.each { |k, v| o.instance_variable_set("@#{k}", v) } }
def ec(c) = obj(RPG::EventCommand, c)
def marshal_files(eng)
  ace = eng == 'vxace'
  s = ->(str) { ace ? str : str.b } # RGSS1/2 (Ruby 1.8) strings carry no encoding ivar
  sys = { switches: SW.map { _1 && s[_1] }, variables: VA.map { _1 && s[_1] } }
  sys[:game_title] = "Fixture #{eng == 'vx' ? 'VX' : 'VX Ace'}" unless eng == 'xp'
  files = { 'System' => obj(RPG::System, sys) }
  files['MapInfos'] = MAPS.to_h { |id, m| [id, obj(RPG::MapInfo, name: s[m[:name]], parent_id: m[:parent], order: id, expanded: false)] }
  MAPS.each do |id, m|
    next if id == 4
    evs = m[:events].to_h do |e|
      pages = e[:pages].map { |p| obj(RPG::Event::Page, condition: obj(RPG::Event::Page::Condition, p[:condition]), list: p[:list].map { ec(_1) }) }
      [e[:id], obj(RPG::Event, id: e[:id], name: s[e[:name]], x: e[:x], y: e[:y], pages: pages)]
    end
    h = { width: 2, height: 2, data: Table.new(2), events: evs }
    h[:display_name] = m[:display] if ace # display names arrived with VX Ace
    files[format('Map%03d', id)] = obj(RPG::Map, h)
  end
  files['CommonEvents'] = [nil] + CE.map { |c| obj(RPG::CommonEvent, c.merge(name: s[c[:name]], list: c[:list].map { ec(_1) })) }
  files['Troops'] = [nil] + TROOPS.map do |t|
    obj(RPG::Troop, id: t[:id], name: s[t[:name]], pages: t[:pages].map { |p| obj(RPG::Troop::Page, condition: obj(RPG::Troop::Page::Condition, p[:condition]), list: p[:list].map { ec(_1) }) })
  end
  ext = { 'vxace' => 'rvdata2', 'vx' => 'rvdata', 'xp' => 'rxdata' }[eng]
  files.to_h { |n, o| ["Data\\#{n}.#{ext}", Marshal.dump(o)] }
end

M32 = 0xFFFFFFFF
step = ->(k) { (k * 7 + 3) & M32 }
crypt = lambda do |data, key|
  out = data.b.dup
  (0...out.bytesize).step(4) do |i|
    4.times { |j| out.setbyte(i + j, out.getbyte(i + j) ^ ((key >> (8 * j)) & 0xff)) if i + j < out.bytesize }
    key = step[key]
  end
  out
end
pack_v1 = lambda do |files|
  key = 0xDEADCAFE; out = +"RGSSAD\0\x01".b
  files.each do |name, data|
    out << [name.bytesize ^ key].pack('V'); key = step[key]
    out << name.bytes.map { |b| r = b ^ (key & 0xff); key = step[key]; r }.pack('C*')
    out << [data.bytesize ^ key].pack('V'); key = step[key]
    out << crypt[data, key]
  end
  out
end
pack_v3 = lambda do |files|
  base = 0x2A; key = (base * 9 + 3) & M32
  index_size = 12 + files.sum { |n, _| 16 + n.bytesize } + 16
  out = +"RGSSAD\0\x03".b << [base].pack('V'); body = +''.b; off = index_size
  files.each_with_index do |(name, data), i|
    fk = (0x1000 + i * 77) & M32
    out << [off ^ key, data.bytesize ^ key, fk ^ key, name.bytesize ^ key].pack('V4')
    out << name.bytes.each_with_index.map { |b, j| b ^ ((key >> (8 * (j % 4))) & 0xff) }.pack('C*')
    body << crypt[data, fk]; off += data.bytesize
  end
  out << [0 ^ key, 0, 0, 0].pack('V4') << body
end

FileUtils.rm_rf(ROOT)
write_json("#{ROOT}/mv/www", mz: false)
write_json("#{ROOT}/mz", mz: true)
FileUtils.mkdir_p("#{ROOT}/mz/js"); File.write("#{ROOT}/mz/js/rmmz_core.js", '')
{ 'vxace' => ['RGSS301.dll', pack_v3, 'Game.rgss3a'], 'vx' => ['RGSS202E.dll', pack_v1, 'Game.rgss2a'],
  'xp' => ['RGSS104E.dll', pack_v1, 'Game.rgssad'] }.each do |eng, (lib, packer, arc)|
  files = marshal_files(eng)
  ini = "[Game]\r\nLibrary=#{lib}\r\nScripts=Data\\Scripts\r\nTitle=Fixture #{eng.upcase}\r\n"
  files.each { |n, d| p = "#{ROOT}/#{eng}/#{n.tr('\\', '/')}"; FileUtils.mkdir_p(File.dirname(p)); File.binwrite(p, d) }
  File.write("#{ROOT}/#{eng}/Game.ini", ini)
  FileUtils.mkdir_p("#{ROOT}/#{eng}-packed")
  File.binwrite("#{ROOT}/#{eng}-packed/#{arc}", packer[files])
  File.write("#{ROOT}/#{eng}-packed/Game.ini", ini)
end
# ---- MV/MZ packaging variants (zip writer: stored + deflate, offsets relative to zip start)
require 'zlib'
def zip(files)
  out = +''.b; cd = +''.b
  files.each do |name, data|
    data = data.b; stored = name.end_with?('package.json')
    body = stored ? data : Zlib::Deflate.new(9, -Zlib::MAX_WBITS).then { |z| z.deflate(data, Zlib::FINISH) }
    hdr = [0x0a, 0, stored ? 0 : 8, 0, 0, Zlib.crc32(data), body.bytesize, data.bytesize, name.bytesize, 0].pack('vvvvvVVVvv')
    cd << [0x02014b50, 0x14].pack('Vv') << hdr << [0, 0, 0, 0, out.bytesize].pack('vvvVV') << name
    out << [0x04034b50].pack('V') << hdr << name << body
  end
  cd_offset = out.bytesize
  out << cd << [0x06054b50, 0, 0, files.size, files.size, cd.bytesize, cd_offset, 0].pack('VvvvvVVv')
end
def tree(dir) = Dir.glob('**/*', base: dir).select { File.file?("#{dir}/#{_1}") }.sort.to_h { [_1, File.binread("#{dir}/#{_1}")] }
FAKE_PE = "MZ\x90\x00".b + ("\x00".b * 508) # stand-in for the NW.js runtime

File.binwrite("#{ROOT}/mv/Game.exe", FAKE_PE) # standard MV deployment: exe + loose www/
FileUtils.mkdir_p("#{ROOT}/mz-exe")           # MZ with the package appended to Game.exe
File.binwrite("#{ROOT}/mz-exe/Game.exe", FAKE_PE + zip({ 'package.json' => '{"name":"fixture","main":"index.html"}' }.merge(tree("#{ROOT}/mz"))))
FileUtils.mkdir_p("#{ROOT}/mv-nw")            # MV with a separate package.nw (keeps the www/ prefix)
File.binwrite("#{ROOT}/mv-nw/package.nw", zip({ 'package.json' => '{"main":"www/index.html"}' }.merge(tree("#{ROOT}/mv").reject { |k, _| k.end_with?('.exe') })))
File.binwrite("#{ROOT}/mv-nw/Game.exe", FAKE_PE)
FileUtils.mkdir_p("#{ROOT}/enigma")
File.binwrite("#{ROOT}/enigma/Game.exe", "MZ\x90\x00".b + ("\x00".b * 380) + ".enigma1\x00".b + ("\x00".b * 120))

puts "fixtures written to #{ROOT}"
