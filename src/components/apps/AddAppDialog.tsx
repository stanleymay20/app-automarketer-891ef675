import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Plus } from "lucide-react";
import { useCreateApp } from "@/hooks/useApps";

const OFFERING_TYPES = [
  "SaaS", "Service", "Agency", "Consulting", "Coaching",
  "Marketplace", "Ecommerce", "Book", "Creator Product",
  "Community", "Enterprise Product", "Nonprofit", "Other",
] as const;

const GOAL_TYPES = [
  { value: "acquire_customers", label: "Acquire customers" },
  { value: "acquire_users", label: "Acquire users" },
  { value: "acquire_clients", label: "Acquire clients" },
  { value: "acquire_members", label: "Acquire members" },
  { value: "acquire_readers", label: "Acquire readers" },
  { value: "acquire_donors", label: "Acquire donors" },
  { value: "acquire_sponsors", label: "Acquire sponsors" },
  { value: "acquire_investors", label: "Acquire investors" },
  { value: "acquire_partners", label: "Acquire partners" },
  { value: "validate_idea", label: "Validate idea" },
  { value: "launch_product", label: "Launch product" },
  { value: "reactivate_audience", label: "Reactivate audience" },
];

const appSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional(),
  target_audience: z.string().max(200).optional(),
  offering_type: z.enum(OFFERING_TYPES).optional(),
  goal_type: z.string().optional(),
  primary_goal: z.enum(["growth", "installs", "signups", "engagement", "awareness"]).optional(),
  brand_tone: z.enum(["professional", "friendly", "bold", "casual", "faith-aligned", "technical"]).optional(),
  website_url: z.string().url("Please enter a valid URL").optional().or(z.literal("")),
  platforms: z.array(z.string()).default([]),
});

type AppFormValues = z.infer<typeof appSchema>;

const platformOptions = [
  { id: "x", label: "X (Twitter)" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "email", label: "Email Newsletter" },
];

const toneOptions = [
  { value: "professional", label: "Professional" },
  { value: "friendly", label: "Friendly" },
  { value: "bold", label: "Bold" },
  { value: "casual", label: "Casual" },
  { value: "faith-aligned", label: "Faith-Aligned" },
  { value: "technical", label: "Technical" },
];

interface AddAppDialogProps {
  trigger?: React.ReactNode;
}

export function AddAppDialog({ trigger }: AddAppDialogProps) {
  const [open, setOpen] = useState(false);
  const createApp = useCreateApp();

  const form = useForm<AppFormValues>({
    resolver: zodResolver(appSchema),
    defaultValues: {
      name: "",
      description: "",
      target_audience: "",
      offering_type: undefined,
      goal_type: undefined,
      primary_goal: undefined,
      brand_tone: "professional",
      website_url: "",
      platforms: [],
    },
  });

  const onSubmit = (values: AppFormValues) => {
    createApp.mutate(
      {
        name: values.name,
        description: values.description || null,
        target_audience: values.target_audience || null,
        offering_type: values.offering_type || null,
        goal_type: values.goal_type || null,
        primary_goal: values.primary_goal || null,
        brand_tone: values.brand_tone || null,
        website_url: values.website_url || null,
        platforms: values.platforms,
      } as any,
      {
        onSuccess: () => {
          setOpen(false);
          form.reset();
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            Add Offering
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Add New Offering</DialogTitle>
          <DialogDescription>
            Tell us what you're growing — a SaaS, service, book, agency, community or any product — so we can tailor everything to your audience.
          </DialogDescription>
        </DialogHeader>


        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>App Name *</FormLabel>
                  <FormControl>
                    <Input placeholder="My Awesome App" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Briefly describe what your app does..."
                      className="resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="target_audience"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Target Audience</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Professionals, Students, Fitness Enthusiasts" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="primary_goal"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Primary Goal</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select goal" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {goalOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="brand_tone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Brand Tone</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select tone" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {toneOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="website_url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Website / App Link</FormLabel>
                  <FormControl>
                    <Input placeholder="https://yourapp.com" type="url" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="platforms"
              render={() => (
                <FormItem>
                  <FormLabel>Platforms to Market On</FormLabel>
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    {platformOptions.map((platform) => (
                      <FormField
                        key={platform.id}
                        control={form.control}
                        name="platforms"
                        render={({ field }) => (
                          <FormItem className="flex items-center space-x-2 space-y-0">
                            <FormControl>
                              <Checkbox
                                checked={field.value?.includes(platform.id)}
                                onCheckedChange={(checked) => {
                                  const newValue = checked
                                    ? [...(field.value || []), platform.id]
                                    : field.value?.filter((v) => v !== platform.id) || [];
                                  field.onChange(newValue);
                                }}
                              />
                            </FormControl>
                            <Label className="text-sm font-normal cursor-pointer">
                              {platform.label}
                            </Label>
                          </FormItem>
                        )}
                      />
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={createApp.isPending}>
                {createApp.isPending ? "Adding..." : "Add App"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
