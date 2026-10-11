using DshRemote.Core;

namespace DshRemote;

internal sealed class SettingsForm : Form
{
    private readonly TextBox web = new(), password = new() { UseSystemPasswordChar = true }, host = new(), user = new(), service = new();
    private readonly NumericUpDown sshPort = Port(0), localPort = Port(18791), remotePort = Port(18790);
    private readonly CheckBox preferSsh = new() { Text = "优先使用 SSH 隧道", AutoSize = true };
    private readonly CheckBox updates = new() { Text = "启动时及每 6 小时检查更新", AutoSize = true };
    internal RemoteSettings Result { get; private set; }
    internal string Password => password.Text;

    internal SettingsForm(RemoteSettings current)
    {
        Result = current;
        Text = "连接设置 · DSH Remote";
        StartPosition = FormStartPosition.CenterParent;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(600, 550);
        var grid = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(20), ColumnCount = 2, RowCount = 13 };
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 148));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        Controls.Add(grid);
        web.Text = current.WebUrl;
        web.PlaceholderText = "https://dsh.example.com";
        password.PlaceholderText = "仅用于此次登录，不保存密码";
        host.Text = current.SshHost;
        host.PlaceholderText = "IP、域名或 SSH config 中的别名";
        user.Text = current.SshUser;
        user.PlaceholderText = "留空使用 SSH 默认用户";
        sshPort.Value = current.SshPort;
        localPort.Value = current.LocalPort;
        remotePort.Value = current.RemotePort;
        service.Text = current.Service;
        preferSsh.Checked = current.PreferSsh;
        updates.Checked = current.CheckUpdates;
        AddRow(grid, 0, "网页地址", web);
        AddRow(grid, 1, "访问密码（可选）", password);
        AddRow(grid, 2, "SSH 服务器（可选）", host);
        AddRow(grid, 3, "SSH 用户", user);
        AddRow(grid, 4, "SSH 端口（0 为默认）", sshPort);
        AddRow(grid, 5, "本地隧道端口", localPort);
        AddRow(grid, 6, "服务器 DSH 端口", remotePort);
        AddRow(grid, 7, "服务器服务名", service);
        grid.Controls.Add(preferSsh, 1, 8);
        grid.Controls.Add(updates, 1, 9);
        var hint = new Label
        {
            Text = "推荐填写网页地址，进入页面后登录。使用 SSH 时，需启用 Windows OpenSSH 客户端，并让服务器信任本机密钥；配置读取 %USERPROFILE%\\.ssh\\config。",
            Dock = DockStyle.Fill, AutoSize = true, Margin = new Padding(0, 12, 0, 12)
        };
        grid.Controls.Add(hint, 0, 10);
        grid.SetColumnSpan(hint, 2);
        var buttons = new FlowLayoutPanel { FlowDirection = FlowDirection.RightToLeft, Dock = DockStyle.Fill, AutoSize = true };
        var connect = new Button { Text = "保存并连接", AutoSize = true };
        var cancel = new Button { Text = "取消", DialogResult = DialogResult.Cancel, AutoSize = true };
        connect.Click += (_, _) => Save();
        buttons.Controls.Add(connect);
        buttons.Controls.Add(cancel);
        grid.Controls.Add(buttons, 0, 11);
        grid.SetColumnSpan(buttons, 2);
        AcceptButton = connect;
        CancelButton = cancel;
    }

    private static NumericUpDown Port(int value) => new() { Minimum = 0, Maximum = 65535, Value = value };
    private static void AddRow(TableLayoutPanel grid, int row, string title, Control field)
    {
        grid.RowStyles.Add(new RowStyle(SizeType.Absolute, 36));
        grid.Controls.Add(new Label { Text = title, Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft }, 0, row);
        field.Dock = DockStyle.Fill;
        field.Margin = new Padding(3, 5, 3, 5);
        grid.Controls.Add(field, 1, row);
    }

    private void Save()
    {
        try
        {
            var candidate = new RemoteSettings
            {
                WebUrl = web.Text.Trim(), SshHost = host.Text.Trim(), SshUser = user.Text.Trim(),
                SshPort = (int)sshPort.Value, LocalPort = (int)localPort.Value, RemotePort = (int)remotePort.Value,
                Service = service.Text.Trim(), PreferSsh = preferSsh.Checked, CheckUpdates = updates.Checked
            };
            candidate.Validate();
            SettingsStore.Save(Program.SettingsPath, candidate);
            Result = candidate;
            DialogResult = DialogResult.OK;
            Close();
        }
        catch (Exception error)
        {
            MessageBox.Show(this, Log.Redact(error.Message), "无法保存连接设置", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }
}
