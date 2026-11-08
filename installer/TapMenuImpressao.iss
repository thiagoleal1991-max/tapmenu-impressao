#define AppVersion GetEnv("APP_VERSION")
#if AppVersion == ""
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{7C0C6F0E-5B1B-4C8E-9E55-7A6F6B1D2A10}
AppName=TapMenu Impressão
AppVersion={#AppVersion}
AppPublisher=TapMenu
DefaultDirName={localappdata}\TapMenuImpressao
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=TapMenuImpressao-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=TapMenu Impressão
CloseApplications=no

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
Source: "..\dist\TapMenuImpressao.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "iniciar-oculto.vbs"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userstartup}\TapMenu Impressão"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\iniciar-oculto.vbs"""; WorkingDir: "{app}"
Name: "{userprograms}\TapMenu\Conectar impressora"; Filename: "{app}\TapMenuImpressao.exe"; Parameters: "--parear --continuar"; WorkingDir: "{app}"
Name: "{userprograms}\TapMenu\Ver registro de impressão"; Filename: "{win}\notepad.exe"; Parameters: """{app}\log.txt"""

[Run]
; Primeira instalação: abre a janela para digitar o código e aguarda terminar.
Filename: "{app}\TapMenuImpressao.exe"; Parameters: "--parear"; WorkingDir: "{app}"; Flags: waituntilterminated; Check: PrecisaParear
; Inicia em segundo plano (sem janela).
Filename: "{sys}\wscript.exe"; Parameters: """{app}\iniciar-oculto.vbs"""; WorkingDir: "{app}"; Flags: nowait runhidden

[Code]
function PrecisaParear: Boolean;
begin
  Result := not FileExists(ExpandConstant('{app}\config.json'));
end;

function InitializeSetup: Boolean;
var R: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM TapMenuImpressao.exe', '', SW_HIDE, ewWaitUntilTerminated, R);
  Result := True;
end;

procedure CurUninstallStepChanged(S: TUninstallStep);
var R: Integer;
begin
  if S = usUninstall then
    Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM TapMenuImpressao.exe', '', SW_HIDE, ewWaitUntilTerminated, R);
end;
